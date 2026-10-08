"""
Donation management routes for the donor workflow.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from flask_jwt_extended import get_jwt_identity, jwt_required, verify_jwt_in_request
from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload
from werkzeug.utils import secure_filename
from PIL import Image

from extensions import db, socketio
from models import Donation, Notification, User
from services.allocation import allocate_pending_requests
from services.freshness import predict_freshness
from services.map_service import geocode_address as resolve_address
from services.map_service import haversine_km, nearby_donations, route_preview
from services.realtime import emit_dashboard_update, emit_notification

donations_bp = Blueprint('donations', __name__)

ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}


def _json(success: bool, message: str, data=None, status: int = 200):
    payload = {'success': success, 'message': message}
    if data is not None:
        payload['data'] = data
    return jsonify(payload), status


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if parsed.tzinfo is not None:
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except ValueError:
        return None


def _parse_quantity(value) -> tuple[float | None, str]:
    if value is None:
        return None, ''

    raw = str(value).strip()
    if not raw:
        return None, ''

    match = re.match(r'^(-?\d+(?:\.\d+)?)\s*(.*)$', raw)
    if match:
        qty = float(match.group(1))
        suffix = match.group(2).strip()
        return qty, suffix

    try:
        return float(raw), ''
    except ValueError:
        return None, ''


def _donation_image_url(filename: str | None) -> str | None:
    if not filename:
        return None
    return f'/api/donations/uploads/{filename}'


def _save_upload(file_storage) -> str:
    if not file_storage or not file_storage.filename:
        raise ValueError('Food image is required')

    filename = secure_filename(file_storage.filename)
    extension = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise ValueError('Invalid image type')

    upload_folder = current_app.config['DONATION_UPLOAD_FOLDER']
    os.makedirs(upload_folder, exist_ok=True)
    unique_name = f'{uuid4().hex}.{extension}'
    full_path = os.path.join(upload_folder, unique_name)
    file_storage.save(full_path)

    try:
        with Image.open(full_path) as img:
            img = img.convert('RGB')
            img.thumbnail((1600, 1600))
            img.save(full_path, optimize=True, quality=82)
    except Exception:
        pass
    return unique_name


def _serialize_donation(donation: Donation, include_requests: bool = False) -> dict:
    donor = donation.donor
    total_qty = float(donation.quantity_number or 0.0)
    rem_qty = float(donation.remaining_quantity) if donation.remaining_quantity is not None else total_qty
    alloc_qty = max(0.0, total_qty - rem_qty)
    data = {
        'id': donation.id,
        'donor_id': donation.donor_id,
        'donor_name': donor.name if donor else None,
        'donor_organization': donor.organization if donor else None,
        'food_name': donation.food_name,
        'food_type': donation.food_type,
        'category': donation.category,
        'veg_type': donation.veg_type,
        'quantity': donation.quantity,
        'total_quantity': total_qty,
        'quantity_number': donation.quantity_number,
        'allocated_quantity': alloc_qty,
        'remaining_quantity': rem_qty,
        'unit': donation.unit or 'meals',
        'description': donation.description,
        'special_instructions': donation.special_instructions,
        'food_image': _donation_image_url(donation.image),
        'image': _donation_image_url(donation.image),
        'pickup_address': donation.pickup_address,
        'pickup_time': donation.pickup_time.isoformat() if donation.pickup_time else None,
        'expiry_time': donation.expiry_time.isoformat() if donation.expiry_time else None,
        'predicted_expiry': donation.predicted_expiry.isoformat() if donation.predicted_expiry else None,
        'freshness_score': donation.freshness_score,
        'risk_level': donation.risk_level,
        'ai_recommendation': donation.ai_recommendation,
        'storage_method': donation.storage_method,
        'current_temperature': donation.current_temperature,
        'latitude': donation.latitude,
        'longitude': donation.longitude,
        'status': donation.status,
        'created_at': donation.created_at.isoformat() if donation.created_at else None,
    }
    if include_requests:
        from models import PickupRequest
        requests_list = []
        for pr in donation.pickup_requests.order_by(PickupRequest.requested_at.asc()).all():
            requests_list.append({
                'id': pr.id,
                'receiver_id': pr.receiver_id,
                'receiver_name': pr.receiver.name if pr.receiver else None,
                'receiver_organization': pr.receiver.organization if pr.receiver else None,
                'requested_quantity': pr.requested_quantity,
                'allocated_quantity': pr.allocated_quantity or 0,
                'status': pr.status,
                'allocation_status': pr.allocation_status,
                'requested_at': pr.requested_at.isoformat() if pr.requested_at else None,
                'approved_at': pr.approved_at.isoformat() if pr.approved_at else None,
                'completed_at': pr.completed_at.isoformat() if pr.completed_at else None,
            })
        data['pickup_requests'] = requests_list
    return data


def _current_user() -> User | None:
    user_id = get_jwt_identity()
    if not user_id:
        return None
    return User.query.get(int(user_id))


def _require_donor() -> User | tuple[dict, int]:
    user = _current_user()
    if not user:
        return {'success': False, 'message': 'Unauthorized'}, 401
    if user.role not in {'donor', 'admin', 'super_admin'}:
        return {'success': False, 'message': 'Only donors can perform this action'}, 403
    if user.role == 'donor':
        if not user.verified:
            return {'success': False, 'message': 'Please verify your email before creating donations.', 'code': 'EMAIL_UNVERIFIED'}, 403
        if user.status == 'rejected':
            return {'success': False, 'message': 'Your account has been rejected by an administrator.', 'code': 'ACCOUNT_REJECTED'}, 403
        if user.status != 'approved':
            return {'success': False, 'message': 'Your account is awaiting admin approval.', 'code': 'ACCOUNT_PENDING_APPROVAL'}, 403
    return user


def _coerce_coordinate(value):
    if value in (None, ''):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_route_geometry(geometry):
    if not geometry:
        return None
    if isinstance(geometry, dict) and geometry.get('type') == 'LineString':
        return {
            'type': 'LineString',
            'coordinates': geometry.get('coordinates', []),
        }
    return geometry


@donations_bp.route('/geocode', methods=['POST'])
@jwt_required(optional=True)
def geocode_donation_address():
    payload = request.get_json(silent=True) or {}
    address = str(payload.get('address') or payload.get('q') or payload.get('pickup_address') or '').strip()
    if not address:
        return _json(False, 'Address is required', status=400)
    try:
        resolved = resolve_address(address)
    except LookupError:
        return _json(False, 'Location not found', status=404)
    except Exception:
        return _json(False, 'Geocoding failed', status=502)

    return _json(True, 'Location resolved', {
        'latitude': resolved['latitude'],
        'longitude': resolved['longitude'],
        'address': resolved.get('address'),
    })


@donations_bp.route('/route', methods=['GET'])
@jwt_required(optional=True)
def donation_route_preview():
    try:
        origin_lat = float(request.args.get('origin_lat'))
        origin_lng = float(request.args.get('origin_lng'))
        dest_lat = float(request.args.get('dest_lat'))
        dest_lng = float(request.args.get('dest_lng'))
    except (TypeError, ValueError):
        return _json(False, 'origin_lat, origin_lng, dest_lat, and dest_lng are required', status=400)

    mode = (request.args.get('mode') or 'driving').strip().lower()
    try:
        route = route_preview(origin_lat, origin_lng, dest_lat, dest_lng, mode=mode)
    except Exception:
        fallback_km = haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
        route = {
            'distance_km': round(fallback_km, 2),
            'distance_m': round(fallback_km * 1000.0),
            'travel_minutes': max(1, int(round(fallback_km * 3.5))),
            'geometry': {
                'type': 'LineString',
                'coordinates': [
                    [origin_lng, origin_lat],
                    [dest_lng, dest_lat],
                ],
            },
        }

    route['geometry'] = _normalize_route_geometry(route.get('geometry'))
    return _json(True, 'Route resolved', {'route': route})


@donations_bp.route('/nearby', methods=['GET'])
@jwt_required(optional=True)
def nearby_available_donations():
    try:
        origin_lat = float(request.args.get('lat'))
        origin_lng = float(request.args.get('lng'))
    except (TypeError, ValueError):
        return _json(False, 'lat and lng are required', status=400)

    try:
        radius_km = float(request.args.get('radius_km', 5))
    except (TypeError, ValueError):
        return _json(False, 'radius_km must be a number', status=400)

    mode = (request.args.get('mode') or 'driving').strip().lower()
    now = datetime.utcnow()

    candidate_query = (
        Donation.query.options(joinedload(Donation.donor))
        .filter(
            Donation.status.in_(['Available', 'AVAILABLE', 'PARTIALLY_ALLOCATED', 'partially_allocated']),
            func.coalesce(Donation.remaining_quantity, Donation.quantity_number) > 0,
            Donation.expiry_time > now,
            Donation.latitude.isnot(None),
            Donation.longitude.isnot(None),
        )
        .all()
    )

    nearby = nearby_donations(origin_lat, origin_lng, radius_km, candidate_query, mode=mode)
    payload = []
    for item in nearby:
        donation = item['donation']
        serialized = _serialize_donation(donation)
        serialized.update({
            'road_distance_km': item['road_distance_km'],
            'estimated_travel_minutes': item['travel_minutes'],
        })
        payload.append(serialized)

    return _json(True, 'Nearby donations loaded', {
        'origin': {
            'latitude': origin_lat,
            'longitude': origin_lng,
        },
        'radius_km': radius_km,
        'mode': mode,
        'donations': payload,
    })


@donations_bp.route('', methods=['POST'])
@donations_bp.route('/', methods=['POST'])
@jwt_required()
def create_donation():
    user = _require_donor()
    if isinstance(user, tuple):
        return user

    is_multipart = request.content_type and request.content_type.startswith('multipart/form-data')
    form = request.form if is_multipart else (request.get_json(silent=True) or {})

    food_name = str(form.get('food_name') or form.get('foodName') or '').strip()
    food_type = str(form.get('food_type') or form.get('foodType') or food_name).strip()
    quantity_input = form.get('quantity')
    pickup_address = str(form.get('pickup_address') or form.get('pickupAddress') or '').strip()
    pickup_time = _parse_dt(form.get('pickup_time') or form.get('pickupTime'))
    expiry_time = _parse_dt(form.get('expiry_time') or form.get('expiryTime'))
    description = str(form.get('description') or '').strip() or None
    category = str(form.get('category') or '').strip() or None
    veg_type = str(form.get('veg_type') or form.get('vegType') or '').strip() or None
    special_instructions = str(form.get('special_instructions') or form.get('specialInstructions') or '').strip() or None
    storage_method = str(form.get('storage_method') or form.get('storageMethod') or '').strip() or None
    current_temperature = form.get('current_temperature') or form.get('currentTemperature')
    latitude = _coerce_coordinate(form.get('latitude'))
    longitude = _coerce_coordinate(form.get('longitude'))

    if not food_name:
        return _json(False, 'Food name is required', status=400)
    if quantity_input is None or str(quantity_input).strip() == '':
        return _json(False, 'Quantity is required', status=400)
    if not pickup_address:
        return _json(False, 'Pickup address is required', status=400)
    if not pickup_time:
        return _json(False, 'Pickup time is required', status=400)
    if not expiry_time:
        return _json(False, 'Expiry time is required', status=400)
    now = datetime.utcnow()
    if pickup_time < now - timedelta(minutes=1):
        return _json(False, 'Pickup time cannot be in the past', status=400)
    if expiry_time < now:
        return _json(False, 'Expiry time cannot be in the past', status=400)
    if expiry_time <= pickup_time:
        return _json(False, 'Expiry time must be after pickup time', status=400)

    qty_num, unit_suffix = _parse_quantity(quantity_input)
    if qty_num is None or qty_num <= 0:
        return _json(False, 'Quantity must be greater than zero', status=400)
    unit = str(form.get('unit') or unit_suffix or 'meals').strip() or 'meals'
    image_file = request.files.get('food_image') or request.files.get('image') or request.files.get('file')
    if not image_file:
        return _json(False, 'Food image is required', status=400)

    try:
        image_name = _save_upload(image_file)
    except ValueError as exc:
        return _json(False, str(exc), status=400)

    if latitude is None or longitude is None:
        try:
            resolved = resolve_address(pickup_address)
            latitude = float(resolved['latitude'])
            longitude = float(resolved['longitude'])
        except Exception:
            return _json(False, 'Unable to geocode pickup address', status=400)

    donation = Donation(
        donor_id=user.id,
        food_name=food_name,
        food_type=food_type,
        category=category,
        veg_type=veg_type,
        quantity=str(quantity_input).strip(),
        quantity_number=qty_num,
        remaining_quantity=qty_num,
        unit=unit,
        description=description,
        special_instructions=special_instructions,
        image=image_name,
        pickup_address=pickup_address,
        pickup_time=pickup_time,
        expiry_time=expiry_time,
        storage_method=storage_method,
        current_temperature=float(current_temperature) if current_temperature not in (None, '') else None,
        latitude=latitude,
        longitude=longitude,
        status='Available',
    )
    freshness = predict_freshness(
        food_category=category or food_type,
        preparation_time=datetime.utcnow(),
        storage_method=storage_method,
        current_temperature=donation.current_temperature,
        pickup_time=pickup_time,
    )
    donation.predicted_expiry = freshness['predicted_expiry']
    donation.freshness_score = freshness['freshness_score']
    donation.risk_level = freshness['risk_level']
    donation.ai_recommendation = freshness['ai_recommendation']
    if freshness['risk_level'] == 'Red' and freshness['predicted_expiry'] <= datetime.utcnow():
        donation.status = 'Expired'
    db.session.add(donation)
    db.session.flush()

    receivers = User.query.filter_by(role='receiver', verified=True).all()
    notifications = []
    
    # 1. Immediate confirmation notification for donor
    donor_notification = Notification(
        user_id=user.id,
        title='Donation Uploaded',
        message='Donation uploaded successfully! Your food donation is now available for receivers.',
        type='success',
        link='/donor/donations',
    )
    db.session.add(donor_notification)
    notifications.append(donor_notification)

    # 2. Notifications for verified receivers
    for receiver in receivers:
        notification = Notification(
            user_id=receiver.id,
            title='New Donation Available',
            message=f'{user.organization or user.name} added {donation.food_name}.',
            type='new_donation',
            link='/receiver/donations',
        )
        db.session.add(notification)
        notifications.append(notification)
    db.session.commit()

    for notification in notifications:
        emit_notification(notification)
    emit_dashboard_update([user.id, *[receiver.id for receiver in receivers]], {
        'reason': 'new_donation',
        'donation_id': donation.id,
    })
    for receiver in receivers:
        socketio.emit('new_donation', {
            'reason': 'new_donation',
            'donation_id': donation.id,
        }, room=f'user_{receiver.id}')

    return _json(True, 'Donation created successfully', {'donation': _serialize_donation(donation)}, status=201)


@donations_bp.route('', methods=['GET'])
@donations_bp.route('/', methods=['GET'])
def list_donations():
    verify_jwt_in_request(optional=True)
    user = None
    try:
        user = _current_user()
    except Exception:
        user = None

    q = Donation.query.options(joinedload(Donation.donor)).order_by(Donation.created_at.desc())
    status = request.args.get('status')
    donor_id = request.args.get('donor_id')

    now = datetime.utcnow()
    if donor_id:
        q = q.filter(Donation.donor_id == donor_id)
    if status:
        q = q.filter(Donation.status == status)
    elif user and user.role == 'receiver':
        q = q.filter(
            Donation.status.in_(['Available', 'AVAILABLE', 'PARTIALLY_ALLOCATED', 'partially_allocated']),
            Donation.remaining_quantity > 0,
            Donation.expiry_time > now,
        )
    elif user and user.role == 'donor':
        q = q.filter(Donation.donor_id == user.id)

    donations = q.all()
    include_requests = bool(user and user.role in {'donor', 'admin', 'super_admin'})
    return _json(True, 'Operation Successful', {'donations': [_serialize_donation(d, include_requests=include_requests) for d in donations]})


@donations_bp.route('/available', methods=['GET'])
def list_available_donations():
    now = datetime.utcnow()
    donations = (
        Donation.query.options(joinedload(Donation.donor))
        .filter(
            Donation.status.in_(['Available', 'AVAILABLE', 'PARTIALLY_ALLOCATED', 'partially_allocated']),
            Donation.remaining_quantity > 0,
            Donation.expiry_time > now,
        )
        .order_by(Donation.expiry_time.asc())
        .all()
    )
    return _json(True, 'Operation Successful', {'donations': [_serialize_donation(d) for d in donations]})


@donations_bp.route('/<int:donation_id>', methods=['GET'])
@jwt_required()
def get_donation(donation_id: int):
    donation = Donation.query.options(joinedload(Donation.donor)).get(donation_id)
    if not donation:
        return _json(False, 'Donation not found', status=404)

    user = _current_user()
    if user and user.role == 'donor' and donation.donor_id != user.id:
        return _json(False, 'Forbidden', status=403)
    if user and user.role == 'receiver' and donation.status != 'Available':
        return _json(False, 'Forbidden', status=403)

    return _json(True, 'Operation Successful', {'donation': _serialize_donation(donation)})


@donations_bp.route('/<int:donation_id>', methods=['PUT'])
@jwt_required()
def update_donation(donation_id: int):
    user = _require_donor()
    if isinstance(user, tuple):
        return user

    donation = Donation.query.get(donation_id)
    if not donation:
        return _json(False, 'Donation not found', status=404)
    if donation.donor_id != user.id and user.role not in {'admin', 'super_admin'}:
        return _json(False, 'Forbidden', status=403)
    if donation.status == 'Completed':
        return _json(False, 'Completed donations cannot be edited', status=400)

    is_multipart = request.content_type and request.content_type.startswith('multipart/form-data')
    data = request.form if is_multipart else (request.get_json(silent=True) or {})

    if 'food_name' in data or 'foodName' in data:
        food_name = str(data.get('food_name') or data.get('foodName') or '').strip()
        if not food_name:
            return _json(False, 'Food name is required', status=400)
        donation.food_name = food_name

    if 'food_type' in data or 'foodType' in data:
        donation.food_type = str(data.get('food_type') or data.get('foodType') or donation.food_type).strip()

    if 'description' in data:
        donation.description = str(data.get('description') or '').strip() or None
    if 'storage_method' in data or 'storageMethod' in data:
        donation.storage_method = str(data.get('storage_method') or data.get('storageMethod') or '').strip() or None
    if 'current_temperature' in data or 'currentTemperature' in data:
        temp = data.get('current_temperature') or data.get('currentTemperature')
        donation.current_temperature = float(temp) if temp not in (None, '') else None

    if 'quantity' in data:
        qty_num, unit_suffix = _parse_quantity(data.get('quantity'))
        if qty_num is None or qty_num <= 0:
            return _json(False, 'Quantity must be greater than zero', status=400)
        already_allocated = max(0, (donation.quantity_number or 0) - (donation.remaining_quantity if donation.remaining_quantity is not None else (donation.quantity_number or 0)))
        if qty_num < already_allocated:
            return _json(False, 'Quantity cannot be reduced below the amount already allocated', status=400)
        donation.quantity = str(data.get('quantity')).strip()
        donation.quantity_number = qty_num
        donation.remaining_quantity = qty_num - already_allocated
        if unit_suffix:
            donation.unit = unit_suffix

    if 'pickup_address' in data or 'pickupAddress' in data:
        pickup_address = str(data.get('pickup_address') or data.get('pickupAddress') or '').strip()
        if not pickup_address:
            return _json(False, 'Pickup address is required', status=400)
        donation.pickup_address = pickup_address
        if donation.latitude is None or donation.longitude is None:
            try:
                resolved = resolve_address(pickup_address)
                donation.latitude = float(resolved['latitude'])
                donation.longitude = float(resolved['longitude'])
            except Exception:
                return _json(False, 'Unable to geocode pickup address', status=400)

    pickup_time_value = data.get('pickup_time') or data.get('pickupTime')
    if pickup_time_value:
        pickup_time = _parse_dt(pickup_time_value)
        if not pickup_time:
            return _json(False, 'Pickup time is invalid', status=400)
        if pickup_time < datetime.utcnow():
            return _json(False, 'Pickup time cannot be in the past', status=400)
        donation.pickup_time = pickup_time

    expiry_time_value = data.get('expiry_time') or data.get('expiryTime')
    if expiry_time_value:
        expiry_time = _parse_dt(expiry_time_value)
        if not expiry_time:
            return _json(False, 'Expiry time is invalid', status=400)
        if expiry_time < datetime.utcnow():
            return _json(False, 'Expiry time cannot be in the past', status=400)
        donation.expiry_time = expiry_time

    image_file = request.files.get('food_image') or request.files.get('image') or request.files.get('file')
    if image_file:
        try:
            donation.image = _save_upload(image_file)
        except ValueError as exc:
            return _json(False, str(exc), status=400)

    if donation.pickup_time and donation.expiry_time and donation.expiry_time <= donation.pickup_time:
        return _json(False, 'Expiry time must be after pickup time', status=400)

    if donation.pickup_time or donation.storage_method or donation.current_temperature is not None:
        freshness = predict_freshness(
            food_category=donation.category or donation.food_type,
            preparation_time=donation.created_at or datetime.utcnow(),
            storage_method=donation.storage_method,
            current_temperature=donation.current_temperature,
            pickup_time=donation.pickup_time,
        )
        donation.predicted_expiry = freshness['predicted_expiry']
        donation.freshness_score = freshness['freshness_score']
        donation.risk_level = freshness['risk_level']
        donation.ai_recommendation = freshness['ai_recommendation']
        if freshness['risk_level'] == 'Red' and freshness['predicted_expiry'] <= datetime.utcnow():
            donation.status = 'Expired'

    if 'status' in data:
        next_status = str(data.get('status')).strip()
        if next_status not in {'Available', 'Requested', 'Approved', 'Completed', 'Expired'}:
            return _json(False, 'Invalid donation status', status=400)
        donation.status = next_status

    db.session.commit()
    emit_dashboard_update([user.id], {
        'reason': 'donation_updated',
        'donation_id': donation.id,
    })
    approved_receivers = User.query.filter_by(role='receiver', status='approved').all()
    for receiver in approved_receivers:
        socketio.emit('donation_updated', {
            'reason': 'donation_updated',
            'donation_id': donation.id,
        }, room=f'user_{receiver.id}')
    return _json(True, 'Donation updated successfully', {'donation': _serialize_donation(donation)})


@donations_bp.route('/<int:donation_id>', methods=['DELETE'])
@jwt_required()
def delete_donation(donation_id: int):
    user = _require_donor()
    if isinstance(user, tuple):
        return user

    donation = Donation.query.get(donation_id)
    if not donation:
        return _json(False, 'Donation not found', status=404)
    if donation.donor_id != user.id and user.role not in {'admin', 'super_admin'}:
        return _json(False, 'Forbidden', status=403)
    if donation.status == 'Completed':
        return _json(False, 'Completed donations cannot be deleted', status=400)

    db.session.delete(donation)
    db.session.commit()
    emit_dashboard_update([user.id], {
        'reason': 'donation_deleted',
        'donation_id': donation_id,
    })
    return _json(True, 'Donation deleted successfully', {})


@donations_bp.route('/uploads/<path:filename>', methods=['GET'])
def donation_uploads(filename):
    upload_folder = current_app.config['DONATION_UPLOAD_FOLDER']
    return send_from_directory(upload_folder, filename)
