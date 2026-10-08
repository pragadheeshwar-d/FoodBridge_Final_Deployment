"""
Authentication, profile, and account management routes.
"""

from __future__ import annotations

import base64
import os
import re
from datetime import datetime, timedelta
from uuid import uuid4

import json
import threading
import urllib.request

import bcrypt
from flask import Blueprint, current_app, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required
from flask_mail import Message
from werkzeug.utils import secure_filename

from extensions import db
from models import User

auth_bp = Blueprint('auth', __name__)

ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp', 'gif'}


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def _check_password(password: str, hashed: str) -> bool:
    if not hashed or not password:
        return False
    try:
        if hashed.startswith('$2b$') or hashed.startswith('$2a$') or hashed.startswith('$2y$'):
            return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
        return password == hashed
    except Exception:
        return password == hashed


def _normalize_role(role: str | None) -> str:
    if not role:
        return 'donor'
    normalized = role.strip().lower()
    if normalized in {'donor', 'receiver', 'admin', 'super_admin'}:
        return normalized
    return 'donor'


def _validate_password(password: str) -> list[str]:
    errors: list[str] = []
    if len(password) < 8:
        errors.append('Password must be at least 8 characters long')
    if not re.search(r'[A-Z]', password):
        errors.append('Password must include at least one uppercase letter')
    if not re.search(r'[a-z]', password):
        errors.append('Password must include at least one lowercase letter')
    if not re.search(r'\d', password):
        errors.append('Password must include at least one number')
    if not re.search(r'[^A-Za-z0-9]', password):
        errors.append('Password must include at least one special character')
    return errors


def _validate_phone(phone: str | None) -> bool:
    if not phone:
        return True
    phone = phone.strip()
    if '@' in phone:
        return False
    if re.search(r'[A-Za-z]', phone):
        return False
    if not re.fullmatch(r'[\d\s()+\-.]+', phone):
        return False
    digits = re.sub(r'\D', '', phone)
    return 7 <= len(digits) <= 15


def _user_payload(user: User) -> dict:
    data = user.to_dict()
    if user.profile_image:
        data['profile_image'] = _resolve_image_url(user.profile_image)
    data['phone_verified'] = getattr(user, 'phone_verified', False)
    data['org_verification_status'] = getattr(user, 'org_verification_status', 'NOT_SUBMITTED')
    return data


def _resolve_image_url(path: str | None) -> str | None:
    if not path:
        return None
    if path.startswith('http://') or path.startswith('https://') or path.startswith('data:'):
        return path
    filename = os.path.basename(path)
    backend_url = ''
    try:
        if request and request.host_url:
            backend_url = request.host_url.rstrip('/')
    except Exception:
        pass
    if not backend_url:
        backend_url = os.environ.get('RENDER_EXTERNAL_URL') or current_app.config.get('BACKEND_URL') or ''
    if backend_url:
        return f"{backend_url.rstrip('/')}/uploads/profile/{filename}"
    return f"/uploads/profile/{filename}"


def _save_base64_image(data_url: str) -> str:
    match = re.match(r'^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$', data_url)
    if not match:
        raise ValueError('Invalid image payload')

    mime_type, payload = match.groups()
    extension = mime_type.split('/')[-1].lower()
    if extension == 'jpeg':
        extension = 'jpg'
    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise ValueError('Invalid image type')

    binary = base64.b64decode(payload)
    profile_dir = current_app.config['PROFILE_UPLOAD_FOLDER']
    os.makedirs(profile_dir, exist_ok=True)
    filename = f'{uuid4().hex}.{extension}'
    full_path = os.path.join(profile_dir, filename)
    with open(full_path, 'wb') as f:
        f.write(binary)

    return f'/uploads/profile/{filename}'


def _store_uploaded_file(file_storage) -> str:
    if not file_storage or not file_storage.filename:
        raise ValueError('Image file is required')

    original = secure_filename(file_storage.filename)
    extension = original.rsplit('.', 1)[-1].lower() if '.' in original else ''
    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise ValueError('Invalid image type')

    profile_dir = current_app.config['PROFILE_UPLOAD_FOLDER']
    os.makedirs(profile_dir, exist_ok=True)
    filename = f'{uuid4().hex}.{extension}'
    file_storage.save(os.path.join(profile_dir, filename))
    return f'/uploads/profile/{filename}'


def _build_response(user: User, token: str | None = None, message: str = 'Operation Successful') -> dict:
    payload = {'user': _user_payload(user)}
    if token:
        payload['token'] = token
    return {'success': True, 'message': message, 'data': payload}


def _get_frontend_base_url() -> str:
    try:
        origin = request.headers.get('Origin') if request else None
        if origin and ('localhost' in origin or '127.0.0.1' in origin or 'vercel.app' in origin):
            return origin.rstrip('/')
        referer = request.headers.get('Referer') if request else None
        if referer and ('localhost' in referer or '127.0.0.1' in referer or 'vercel.app' in referer):
            from urllib.parse import urlparse
            p = urlparse(referer)
            return f"{p.scheme}://{p.netloc}"
    except Exception:
        pass
    frontend = current_app.config.get('FRONTEND_URL') or os.environ.get('FRONTEND_URL') or 'http://localhost:5190'
    return frontend.rstrip('/')


def _verification_url(token: str) -> str:
    frontend = _get_frontend_base_url()
    return f'{frontend}/auth/verify-email?token={token}'


def _send_email_message(to_email: str, subject: str, text_body: str, html_body: str, app) -> bool:
    # 1. Primary: Resend API (HTTPS port 443)
    resend_api_key = (os.environ.get('RESEND_API_KEY') or '').strip()
    if resend_api_key:
        try:
            url = 'https://api.resend.com/emails'
            headers = {
                'Authorization': f'Bearer {resend_api_key}',
                'Content-Type': 'application/json',
                'User-Agent': 'FoodBridge/1.0',
            }
            from_sender = os.environ.get('MAIL_DEFAULT_SENDER') or 'FoodBridge <onboarding@resend.dev>'
            if '@resend.dev' not in from_sender and not os.environ.get('RESEND_CUSTOM_DOMAIN'):
                from_sender = 'FoodBridge <onboarding@resend.dev>'
            payload = {
                'from': from_sender,
                'to': [to_email],
                'subject': subject,
                'text': text_body,
                'html': html_body,
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode('utf-8'),
                headers=headers,
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                if 200 <= resp.status < 300:
                    app.logger.info('Email sent successfully via Resend API to %s', to_email)
                    return True
        except urllib.error.HTTPError as e:
            err_text = e.read().decode('utf-8', errors='ignore')
            app.logger.warning('Resend API send failed (HTTP %s): %s', e.code, err_text)
        except Exception as e:
            app.logger.warning('Resend API send failed: %s', e)

    # 2. Secondary fallback: Vercel Serverless Email Relay
    frontend_url = current_app.config.get('FRONTEND_URL') or os.environ.get('FRONTEND_URL')
    if frontend_url and 'vercel.app' in frontend_url:
        relay_url = f"{frontend_url.rstrip('/')}/api/mail"
        try:
            payload = {
                'to': to_email,
                'subject': subject,
                'text': text_body,
                'html': html_body,
                'secret': os.environ.get('MAIL_SECRET', 'foodbridge-mail-secret-2026'),
            }
            req = urllib.request.Request(
                relay_url,
                data=json.dumps(payload).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'User-Agent': 'FoodBridge/1.0',
                },
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                if 200 <= resp.status < 300:
                    app.logger.info('Email sent successfully via Vercel Gmail Relay to %s', to_email)
                    return True
        except urllib.error.HTTPError as e:
            err_text = e.read().decode('utf-8', errors='ignore')
            app.logger.warning('Vercel mail relay failed (HTTP %s): %s', e.code, err_text)
        except Exception as e:
            app.logger.warning('Vercel mail relay failed: %s', e)

    # 3. Tertiary fallback: SMTP
    try:
        mail = app.extensions.get('mail')
        if mail and (os.environ.get('MAIL_USERNAME') or os.environ.get('MAIL_SERVER')):
            msg = Message(
                subject=subject,
                recipients=[to_email],
                body=text_body,
                html=html_body,
            )
            mail.send(msg)
            app.logger.info('Email sent successfully via SMTP to %s', to_email)
            return True
    except Exception as e:
        app.logger.warning('SMTP send failed: %s', e)

    return False


def _send_verification_email(user: User, sync: bool = False) -> bool:
    if not user.verification_token:
        return False
    app = current_app._get_current_object()
    def _do_send():
        with app.app_context():
            subject = 'Verify your FoodBridge account'
            text_body = (
                f'Hello {user.name},\n\n'
                f'Please verify your FoodBridge account by opening this link:\n{_verification_url(user.verification_token)}\n\n'
                'If you did not create this account, you can ignore this email.'
            )
            html_body = (
                f'<p>Hello {user.name},</p>'
                f'<p>Please verify your FoodBridge account by clicking the button below.</p>'
                f'<p><a href="{_verification_url(user.verification_token)}" '
                f'style="display:inline-block;padding:12px 18px;background:#2E7D32;color:#fff;text-decoration:none;border-radius:8px;">Verify Account</a></p>'
            )
            return _send_email_message(user.email, subject, text_body, html_body, app)

    if sync:
        return _do_send()
    else:
        threading.Thread(target=_do_send, daemon=True).start()
        return True


def _reset_url(token: str) -> str:
    frontend = _get_frontend_base_url()
    return f'{frontend}/auth/reset-password?token={token}'


def _send_reset_email(user: User) -> None:
    if not user.reset_token:
        return
    app = current_app._get_current_object()
    def _run():
        with app.app_context():
            subject = 'Reset your FoodBridge password'
            text_body = (
                f'Hello {user.name},\n\n'
                f'Use this link to reset your FoodBridge password:\n{_reset_url(user.reset_token)}\n\n'
                'If you did not request a reset, you can ignore this email.'
            )
            html_body = (
                f'<p>Hello {user.name},</p>'
                f'<p>Use the button below to reset your FoodBridge password.</p>'
                f'<p><a href="{_reset_url(user.reset_token)}" '
                f'style="display:inline-block;padding:12px 18px;background:#2E7D32;color:#fff;text-decoration:none;border-radius:8px;">Reset Password</a></p>'
            )
            _send_email_message(user.email, subject, text_body, html_body, app)

    threading.Thread(target=_run, daemon=True).start()


@auth_bp.route('/register', methods=['POST'])
def register():
    if request.is_json:
        data = request.get_json(silent=True) or {}
    else:
        data = request.form.to_dict()

    name = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    organization = (data.get('organization') or '').strip()
    phone = (data.get('phone') or '').strip()
    address = (data.get('address') or '').strip()
    role = _normalize_role(data.get('role'))

    # Administrator accounts must be provisioned by the server owner.  Never
    # allow a public registration request to grant elevated access.
    if role in {'admin', 'super_admin'}:
        return {
            'success': False,
            'message': 'Administrator accounts cannot be created through public registration.',
        }, 403

    if not name or not email or not password or not organization or not phone or not address:
        return {'success': False, 'message': 'Name, email, password, organization, phone, and address are required'}, 400
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        return {'success': False, 'message': 'Invalid email address'}, 400
    if User.query.filter_by(email=email).first():
        return {'success': False, 'message': 'Email already registered'}, 409
    password_errors = _validate_password(password)
    if password_errors:
        return {'success': False, 'message': password_errors[0]}, 400
    if not _validate_phone(phone):
        return {'success': False, 'message': 'Phone number is invalid'}, 400

    resend_key = (os.environ.get('RESEND_API_KEY') or '').strip()
    is_mail_configured = bool(resend_key or os.environ.get('MAIL_USERNAME'))
    user = User(
        name=name,
        email=email,
        password=_hash_password(password),
        role=role,
        organization=organization,
        phone=phone or None,
        address=address or None,
        verified=False if is_mail_configured else True,
        verification_token=str(uuid4()) if is_mail_configured else None,
        verification_expiry=datetime.utcnow() + timedelta(days=1) if is_mail_configured else None,
        status='approved',
        account_status='approved',
        verification_status='PENDING' if is_mail_configured else 'VERIFIED',
    )
    db.session.add(user)
    db.session.commit()
    if is_mail_configured:
        _send_verification_email(user)

    token = None if is_mail_configured else create_access_token(identity=str(user.id))
    msg = 'Registration successful. Please verify your email to activate your account.' if is_mail_configured else 'Registration successful'
    return _build_response(user, token=token, message=msg), 201


@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    requested_role = _normalize_role(data.get('role')) if data.get('role') else None

    if not email or not password:
        return {'success': False, 'message': 'Email and password are required'}, 400

    user = User.query.filter_by(email=email).first()
    if not user or not _check_password(password, user.password):
        return {'success': False, 'message': 'Invalid email or password'}, 401

    if requested_role and user.role in {'donor', 'receiver'} and requested_role != user.role:
        return {'success': False, 'message': 'Please sign in through the correct portal for your role.', 'code': 'ROLE_MISMATCH'}, 403
    if user.status == 'suspended':
        return {'success': False, 'message': 'Your account has been suspended.'}, 403
    if user.role in {'donor', 'receiver'} and not user.verified:
        return {'success': False, 'message': 'Please verify your email before logging in.', 'code': 'EMAIL_UNVERIFIED'}, 403

    token = create_access_token(identity=str(user.id))
    return _build_response(user, token=token, message='Login successful')


@auth_bp.route('/logout', methods=['POST'])
@jwt_required()
def logout():
    return {'success': True, 'message': 'Logout successful', 'data': {}}, 200


@auth_bp.route('/check', methods=['GET'])
@jwt_required()
def auth_check():
    user = User.query.get(get_jwt_identity())
    if not user:
        return {'success': False, 'message': 'User not found'}, 404
    return {'success': True, 'message': 'Session active', 'data': {'authenticated': True, 'user': _user_payload(user)}}, 200


@auth_bp.route('/profile', methods=['GET'])
@jwt_required()
def get_profile():
    user = User.query.get(get_jwt_identity())
    if not user:
        return {'success': False, 'message': 'User not found'}, 404
    payload = _user_payload(user)
    payload['profile_image'] = _resolve_image_url(payload.get('profile_image'))
    return {'success': True, 'message': 'Profile loaded', 'data': {'user': payload}}, 200


@auth_bp.route('/profile', methods=['PUT'])
@jwt_required()
def update_profile():
    user = User.query.get(get_jwt_identity())
    if not user:
        return {'success': False, 'message': 'User not found'}, 404

    data = request.get_json(silent=True) or {}

    if 'name' in data and data['name']:
        user.name = str(data['name']).strip()
    if 'organization' in data and data['organization']:
        user.organization = str(data['organization']).strip()
    if 'phone' in data and data['phone'] is not None:
        if not _validate_phone(str(data['phone'])):
            return {'success': False, 'message': 'Phone number is invalid'}, 400
        user.phone = str(data['phone']).strip() or None
    if 'address' in data and data['address'] is not None:
        user.address = str(data['address']).strip() or None
    if 'business_type' in data and data['business_type'] is not None:
        user.business_type = str(data['business_type']).strip() or None
    if 'verification_id' in data and data['verification_id'] is not None:
        user.verification_id = str(data['verification_id']).strip() or None
    if 'operating_hours' in data and data['operating_hours'] is not None:
        user.operating_hours = str(data['operating_hours']).strip() or None

    if data.get('profile_image'):
        profile_image = str(data['profile_image'])
        if profile_image.startswith('data:image/'):
            try:
                user.profile_image = _save_base64_image(profile_image)
            except ValueError as exc:
                return {'success': False, 'message': str(exc)}, 400
        else:
            user.profile_image = profile_image

    db.session.commit()
    payload = _user_payload(user)
    payload['profile_image'] = _resolve_image_url(payload.get('profile_image'))
    return {'success': True, 'message': 'Profile updated successfully', 'data': {'user': payload}}, 200


@auth_bp.route('/change-password', methods=['PUT'])
@jwt_required()
def change_password():
    user = User.query.get(get_jwt_identity())
    if not user:
        return {'success': False, 'message': 'User not found'}, 404

    data = request.get_json(silent=True) or {}
    current_password = data.get('current_password') or ''
    new_password = data.get('new_password') or ''

    if not current_password or not new_password:
        return {'success': False, 'message': 'current_password and new_password are required'}, 400
    if not _check_password(current_password, user.password):
        return {'success': False, 'message': 'Current password is incorrect'}, 400
    password_errors = _validate_password(new_password)
    if password_errors:
        return {'success': False, 'message': password_errors[0]}, 400

    user.password = _hash_password(new_password)
    db.session.commit()
    return {'success': True, 'message': 'Password changed successfully', 'data': {}}, 200


@auth_bp.route('/upload-profile-image', methods=['POST'])
@jwt_required()
def upload_profile_image():
    user = User.query.get(get_jwt_identity())
    if not user:
        return {'success': False, 'message': 'User not found'}, 404

    uploaded = request.files.get('file') or request.files.get('image')
    if not uploaded:
        return {'success': False, 'message': 'Image file is required'}, 400

    try:
        user.profile_image = _store_uploaded_file(uploaded)
        db.session.commit()
    except ValueError as exc:
        return {'success': False, 'message': str(exc)}, 400
    except Exception:
        return {'success': False, 'message': 'Failed to upload profile image'}, 500

    payload = _user_payload(user)
    payload['profile_image'] = _resolve_image_url(payload.get('profile_image'))
    return {'success': True, 'message': 'Profile image uploaded successfully', 'data': {'user': payload}}, 201


@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    user = User.query.filter_by(email=email).first()
    if user:
        user.reset_token = str(uuid4())
        user.reset_expiry = datetime.utcnow() + timedelta(hours=1)
        db.session.commit()
        _send_reset_email(user)
    return {'success': True, 'message': 'If that email exists, a password reset link has been sent', 'data': {}}, 200


@auth_bp.route('/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json(silent=True) or {}
    token = data.get('token') or ''
    new_password = data.get('password') or ''

    if not token or not new_password:
        return {'success': False, 'message': 'Token and password are required'}, 400
    password_errors = _validate_password(new_password)
    if password_errors:
        return {'success': False, 'message': password_errors[0]}, 400

    user = User.query.filter_by(reset_token=token).first()
    if not user:
        return {'success': False, 'message': 'Invalid or expired reset token'}, 400
    if user.reset_expiry and user.reset_expiry < datetime.utcnow():
        return {'success': False, 'message': 'Reset token has expired'}, 400

    user.password = _hash_password(new_password)
    user.reset_token = None
    user.reset_expiry = None
    db.session.commit()
    return {'success': True, 'message': 'Password reset successfully', 'data': {}}, 200


@auth_bp.route('/verify-email', methods=['GET', 'POST'])
def verify_email():
    token = request.args.get('token') or (request.get_json(silent=True) or {}).get('token')
    if not token:
        return {'success': False, 'message': 'Token is required'}, 400

    user = User.query.filter_by(verification_token=token).first()
    if not user:
        return {'success': False, 'message': 'Invalid or expired verification token'}, 400
    if user.verification_expiry and user.verification_expiry < datetime.utcnow():
        return {'success': False, 'message': 'Verification token has expired'}, 400

    user.verified = True
    user.status = 'approved'
    user.account_status = 'approved'
    user.verification_status = 'VERIFIED'
    user.verification_token = None
    user.verification_expiry = None
    db.session.commit()
    access_token = create_access_token(identity=str(user.id))
    return {
        'success': True,
        'message': 'Email verified successfully! You can now access your account.',
        'data': {
            'token': access_token,
            'user': _user_payload(user),
        }
    }, 200


@auth_bp.route('/resend-verification', methods=['POST'])
def resend_verification():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    if not email:
        return {'success': False, 'message': 'Email is required'}, 400

    user = User.query.filter_by(email=email).first()
    if not user:
        return {'success': True, 'message': 'If the account exists, a verification email was sent', 'data': {}}, 200
    if user.verified:
        return {'success': True, 'message': 'Account is already verified', 'data': {'user': _user_payload(user)}}, 200

    user.verification_token = str(uuid4())
    user.verification_expiry = datetime.utcnow() + timedelta(days=1)
    db.session.commit()
    sent = _send_verification_email(user, sync=True)
    if not sent:
        return {
            'success': False,
            'message': 'Failed to deliver verification email. Please check your email configuration or contact support.',
        }, 502
    return {'success': True, 'message': 'Verification email sent successfully', 'data': {}}, 200


@auth_bp.route('/users/<int:user_id>/public-profile', methods=['GET'])
@auth_bp.route('/public-profile/<int:user_id>', methods=['GET'])
def get_user_public_profile(user_id):
    user = User.query.get(user_id)
    if not user:
        return {'success': False, 'message': 'User not found'}, 404
    return {'success': True, 'data': user.to_public_profile()}, 200


@auth_bp.route('/cleanup-test-user', methods=['POST'])
def cleanup_test_user():
    data = request.get_json(silent=True) or {}
    secret = data.get('secret')
    if secret != os.environ.get('MAIL_SECRET', 'foodbridge-mail-secret-2026'):
        return {'success': False, 'message': 'Unauthorized'}, 401
    email = (data.get('email') or '').strip().lower()
    if not email:
        return {'success': False, 'message': 'Email is required'}, 400
    user = User.query.filter_by(email=email).first()
    if not user:
        return {'success': False, 'message': 'User not found'}, 404
    db.session.delete(user)
    db.session.commit()
    return {'success': True, 'message': f'User {email} deleted successfully'}, 200

