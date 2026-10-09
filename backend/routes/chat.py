"""
Real-time chat and conversation routes for FoodBridge.
Strictly restricts communication between verified Donors and Receivers/NGOs
associated with valid donation/request transactions.
"""
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import or_, and_
from extensions import db, socketio
from models import Conversation, Message, User, Donation, PickupRequest, FoodNeed, Notification, CallSession
from services.realtime import emit_message, emit_notification

chat_bp = Blueprint('chat', __name__)


def _get_authenticated_user():
    """Retrieve and validate the authenticated donor or receiver."""
    raw_identity = get_jwt_identity()
    if not raw_identity:
        return None, (jsonify({'success': False, 'message': 'Authentication required'}), 401)
    
    user = User.query.get(int(raw_identity))
    if not user:
        return None, (jsonify({'success': False, 'message': 'User not found'}), 404)

    if not user.verified:
        return None, (jsonify({'success': False, 'message': 'Please verify your email.', 'code': 'EMAIL_UNVERIFIED'}), 403)

    if user.status == 'rejected':
        return None, (jsonify({'success': False, 'message': 'Your account has been rejected by an administrator.', 'code': 'ACCOUNT_REJECTED'}), 403)

    if user.status != 'approved':
        return None, (jsonify({'success': False, 'message': 'Your account is awaiting admin approval.', 'code': 'ACCOUNT_PENDING_APPROVAL'}), 403)

    # Strictly Donor or Receiver only
    if user.role not in ('donor', 'receiver'):
        return None, (jsonify({'success': False, 'message': 'Messaging is strictly limited to Donors and Receivers/NGOs.', 'code': 'ROLE_NOT_PERMITTED'}), 403)

    return user, None


@chat_bp.route('/conversations', methods=['GET'])
@jwt_required()
def get_conversations():
    """
    Return all valid donor ↔ receiver conversations for the authenticated user.
    Donors see ONLY conversations where they are the donor.
    Receivers see ONLY conversations where they are the receiver.
    """
    user, err = _get_authenticated_user()
    if err:
        return err

    query = Conversation.query
    if user.role == 'donor':
        query = query.filter(Conversation.donor_id == user.id)
    else:
        query = query.filter(Conversation.receiver_id == user.id)

    conversations = query.order_by(Conversation.updated_at.desc(), Conversation.id.desc()).all()

    # Filter out invalid records where partner is deleted or role mismatch, and enforce ONE chat per partner
    results = []
    seen_partner_ids = set()
    for conv in conversations:
        # Validate partner exists and is opposite role
        partner = conv.receiver if user.role == 'donor' else conv.donor
        if not partner or partner.role == user.role or partner.role not in ('donor', 'receiver'):
            continue

        if partner.id in seen_partner_ids:
            continue
        seen_partner_ids.add(partner.id)

        results.append(conv.to_dict(current_user_id=user.id))

    return jsonify(results), 200


@chat_bp.route('/conversations/<int:conv_id>', methods=['GET'])
@jwt_required()
def get_single_conversation(conv_id: int):
    """Fetch details of a single conversation with security authorization check."""
    user, err = _get_authenticated_user()
    if err:
        return err

    conv = Conversation.query.get(conv_id)
    if not conv:
        return jsonify({'success': False, 'message': 'Conversation not found'}), 404

    # Security check: User must be donor or receiver in this conversation
    if user.id not in (conv.donor_id, conv.receiver_id):
        return jsonify({'success': False, 'message': 'Unauthorized to access this conversation'}), 403

    return jsonify(conv.to_dict(current_user_id=user.id)), 200


@chat_bp.route('/conversations/<int:conv_id>/messages', methods=['GET'])
@jwt_required()
def get_conversation_messages(conv_id: int):
    """
    Load chronological chat history for a specific conversation.
    Verifies user authorization, marks received unread messages as read,
    and returns dynamic message data.
    """
    user, err = _get_authenticated_user()
    if err:
        return err

    conv = Conversation.query.get(conv_id)
    if not conv:
        return jsonify({'success': False, 'message': 'Conversation not found'}), 404

    # Strict authorization: User must be a participant
    if user.id not in (conv.donor_id, conv.receiver_id):
        return jsonify({'success': False, 'message': 'Unauthorized to access this conversation'}), 403

    messages = (
        Message.query
        .filter_by(conversation_id=conv.id)
        .order_by(Message.created_at.asc(), Message.id.asc())
        .all()
    )

    # Mark all incoming unread messages as read
    unread = (
        Message.query
        .filter(
            Message.conversation_id == conv.id,
            Message.receiver_id == user.id,
            Message.is_read == False  # noqa: E712
        )
        .all()
    )

    if unread:
        partner_id = conv.receiver_id if user.id == conv.donor_id else conv.donor_id
        read_ids = [m.id for m in unread]
        for m in unread:
            m.is_read = True
        db.session.commit()

        # Emit Socket.IO read receipts to partner
        payload = {'conversation_id': conv.id, 'message_ids': read_ids, 'reader_id': user.id}
        socketio.emit('messages_read', payload, room=f'user_{partner_id}')
        socketio.emit('message_read', payload, room=f'user_{partner_id}')

    return jsonify([m.to_dict() for m in messages]), 200


@chat_bp.route('/conversations/<int:conv_id>/read', methods=['POST'])
@jwt_required()
def mark_conversation_read(conv_id: int):
    """Explicit endpoint to mark messages in a conversation as read."""
    user, err = _get_authenticated_user()
    if err:
        return err

    conv = Conversation.query.get(conv_id)
    if not conv:
        return jsonify({'success': False, 'message': 'Conversation not found'}), 404

    if user.id not in (conv.donor_id, conv.receiver_id):
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    unread = Message.query.filter(
        Message.conversation_id == conv.id,
        Message.receiver_id == user.id,
        Message.is_read == False  # noqa: E712
    ).all()

    if unread:
        partner_id = conv.receiver_id if user.id == conv.donor_id else conv.donor_id
        read_ids = [m.id for m in unread]
        for m in unread:
            m.is_read = True
        db.session.commit()

        payload = {'conversation_id': conv.id, 'message_ids': read_ids, 'reader_id': user.id}
        socketio.emit('messages_read', payload, room=f'user_{partner_id}')
        socketio.emit('message_read', payload, room=f'user_{partner_id}')

    return jsonify({'success': True, 'read_count': len(unread)}), 200


@chat_bp.route('/conversations/lookup', methods=['GET', 'POST'])
@jwt_required()
def lookup_or_create_conversation():
    """
    Find or securely create a conversation given partner_id and donation_id or pickup_id.
    Validates the relationship before creating any conversation.
    """
    user, err = _get_authenticated_user()
    if err:
        return err

    data = request.get_json(silent=True) if request.method == 'POST' else request.args
    data = data or {}

    partner_id = data.get('partner_id') or data.get('partnerId')
    donation_id = data.get('donation_id') or data.get('donationId')
    pickup_id = data.get('pickup_id') or data.get('pickupId')
    need_id = data.get('need_id') or data.get('needId')

    if not partner_id:
        return jsonify({'success': False, 'message': 'partner_id is required'}), 400

    partner = User.query.get(int(partner_id))
    if not partner:
        return jsonify({'success': False, 'message': 'Partner user not found'}), 404

    # Role enforcement: exactly one donor and one receiver
    if (user.role == 'donor' and partner.role != 'receiver') or (user.role == 'receiver' and partner.role != 'donor'):
        return jsonify({'success': False, 'message': 'Messaging is only permitted between a Donor and a Receiver/NGO'}), 403

    donor_id = user.id if user.role == 'donor' else partner.id
    receiver_id = user.id if user.role == 'receiver' else partner.id

    # Validate donation / pickup / food need existence
    donation = None
    pickup = None
    need = None

    if donation_id:
        donation = Donation.query.get(int(donation_id))
        if donation and donation.donor_id != donor_id:
            donation = None

    if pickup_id:
        pickup = PickupRequest.query.get(int(pickup_id))
        if pickup and pickup.receiver_id != receiver_id:
            pickup = None
        if pickup and not donation:
            donation = pickup.donation

    if need_id:
        need = FoodNeed.query.get(int(need_id))
        if need and need.receiver_id != receiver_id:
            need = None

    # If neither donation nor pickup was passed, look for existing pickup between these two users
    if not donation and not pickup:
        pickup = (
            PickupRequest.query
            .join(Donation)
            .filter(Donation.donor_id == donor_id, PickupRequest.receiver_id == receiver_id)
            .order_by(PickupRequest.requested_at.desc())
            .first()
        )
        if pickup:
            donation = pickup.donation

    # If no need passed, check if receiver has any open food need
    if not need:
        need = FoodNeed.query.filter_by(receiver_id=receiver_id).order_by(FoodNeed.created_at.desc()).first()

    # Strictly ONE conversation per pair: check for existing conversation
    conv = Conversation.query.filter_by(
        donor_id=donor_id,
        receiver_id=receiver_id,
    ).first()

    if conv:
        # Update existing conversation context with latest donation / pickup / need
        if donation:
            conv.donation_id = donation.id
        if pickup:
            conv.request_id = pickup.id
        if need and not conv.need_id:
            conv.need_id = need.id
        conv.updated_at = datetime.utcnow()
        db.session.commit()
    else:
        conv = Conversation(
            donor_id=donor_id,
            receiver_id=receiver_id,
            donation_id=donation.id if donation else None,
            request_id=pickup.id if pickup else None,
            need_id=need.id if need else None,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.session.add(conv)
        db.session.commit()

    return jsonify({'success': True, 'conversation': conv.to_dict(current_user_id=user.id)}), 200


@chat_bp.route('/messages', methods=['POST'])
@jwt_required()
def send_message():
    """
    Send a message within a validated conversation between donor and receiver.
    Saves to local database, creates recipient notification, and pushes real-time event.
    """
    user, err = _get_authenticated_user()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    text = str(data.get('message', '')).strip()

    if not text:
        return jsonify({'success': False, 'message': 'Message cannot be empty.'}), 400

    conv_id = data.get('conversation_id') or data.get('conversationId')
    conv = None

    if conv_id:
        conv = Conversation.query.get(int(conv_id))
        if not conv:
            return jsonify({'success': False, 'message': 'Conversation not found.'}), 404
        if user.id not in (conv.donor_id, conv.receiver_id):
            return jsonify({'success': False, 'message': 'Unauthorized to send message in this conversation.'}), 403
        recipient_id = conv.receiver_id if user.id == conv.donor_id else conv.donor_id
    else:
        # Fallback: identify by receiver_id / partner_id
        receiver_id = data.get('receiver_id') or data.get('receiverId') or data.get('partner_id')
        if not receiver_id:
            return jsonify({'success': False, 'message': 'conversation_id or receiver_id is required.'}), 400

        partner = User.query.get(int(receiver_id))
        if not partner:
            return jsonify({'success': False, 'message': 'Recipient not found.'}), 404

        # Enforce Donor ↔ Receiver only
        if (user.role == 'donor' and partner.role != 'receiver') or (user.role == 'receiver' and partner.role != 'donor'):
            return jsonify({'success': False, 'message': 'Messaging is only permitted between a Donor and a Receiver/NGO.'}), 403

        donor_id = user.id if user.role == 'donor' else partner.id
        partner_receiver_id = user.id if user.role == 'receiver' else partner.id

        donation_id = data.get('donation_id') or data.get('donationId')
        pickup_id = data.get('pickup_id') or data.get('pickupId')
        need_id = data.get('need_id') or data.get('needId')

        donation = None
        pickup = None
        need = None
        if donation_id:
            donation = Donation.query.get(int(donation_id))
            if donation and donation.donor_id != donor_id:
                donation = None
        if pickup_id:
            pickup = PickupRequest.query.get(int(pickup_id))
            if pickup and pickup.receiver_id != partner_receiver_id:
                pickup = None
            if pickup and not donation:
                donation = pickup.donation
        if need_id:
            need = FoodNeed.query.get(int(need_id))
            if need and need.receiver_id != partner_receiver_id:
                need = None

        if not donation and not pickup:
            pickup = (
                PickupRequest.query
                .join(Donation)
                .filter(Donation.donor_id == donor_id, PickupRequest.receiver_id == partner_receiver_id)
                .order_by(PickupRequest.requested_at.desc())
                .first()
            )
            if pickup:
                donation = pickup.donation

        if not need:
            need = FoodNeed.query.filter_by(receiver_id=partner_receiver_id).order_by(FoodNeed.created_at.desc()).first()

        conv = Conversation.query.filter_by(
            donor_id=donor_id,
            receiver_id=partner_receiver_id,
        ).first()

        if not conv:
            conv = Conversation(
                donor_id=donor_id,
                receiver_id=partner_receiver_id,
                donation_id=donation.id if donation else None,
                request_id=pickup.id if pickup else None,
                need_id=need.id if need else None,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            db.session.add(conv)
            db.session.flush()
        else:
            if donation:
                conv.donation_id = donation.id
            if pickup:
                conv.request_id = pickup.id
            if need and not conv.need_id:
                conv.need_id = need.id
            conv.updated_at = datetime.utcnow()
            db.session.flush()

        recipient_id = partner.id

    # Prevent duplicate identical messages sent within 2 seconds
    two_sec_ago = datetime.utcnow() - timedelta(seconds=2)
    recent = (
        Message.query
        .filter(
            Message.conversation_id == conv.id,
            Message.sender_id == user.id,
            Message.message == text,
            Message.created_at >= two_sec_ago
        )
        .first()
    )
    if recent:
        return jsonify({'success': True, 'message': 'Sent', 'data': recent.to_dict()}), 200

    # Save to local database
    msg = Message(
        conversation_id=conv.id,
        sender_id=user.id,
        receiver_id=recipient_id,
        message=text,
        donation_id=conv.donation_id,
        pickup_id=conv.request_id,
        need_id=conv.need_id,
        is_read=False,
        created_at=datetime.utcnow()
    )
    db.session.add(msg)
    conv.updated_at = datetime.utcnow()

    # Create in-app notification for recipient
    recipient = User.query.get(recipient_id)
    sender_name = user.organization or user.name
    notif = Notification(
        user_id=recipient_id,
        title=f"New message from {sender_name}",
        message=text[:120],
        type='new_message',
        link=f"/{recipient.role}/messages?conversationId={conv.id}",
    )
    db.session.add(notif)
    db.session.commit()

    msg_dict = msg.to_dict()

    # Push real-time to both recipient and sender via Socket.IO
    emit_message([recipient_id, user.id], msg_dict)
    emit_notification(notif)

    return jsonify({'success': True, 'message': 'Sent', 'data': msg_dict}), 201


@chat_bp.route('/messages/<int:partner_id>', methods=['GET'])
@jwt_required()
def legacy_get_messages_by_partner(partner_id: int):
    """
    Backward-compatibility route: retrieves messages for the latest active conversation
    between user and partner_id.
    """
    user, err = _get_authenticated_user()
    if err:
        return err

    conv = (
        Conversation.query
        .filter(
            or_(
                and_(Conversation.donor_id == user.id, Conversation.receiver_id == partner_id),
                and_(Conversation.donor_id == partner_id, Conversation.receiver_id == user.id)
            )
        )
        .order_by(Conversation.updated_at.desc())
        .first()
    )

    if not conv:
        return jsonify([]), 200

    return get_conversation_messages(conv.id)


@chat_bp.route('/messages', methods=['GET'])
@jwt_required()
def get_messages_or_conversations():
    """Dispatcher for legacy query params."""
    partner_id = request.args.get('partner_id') or request.args.get('partnerId')
    conv_id = request.args.get('conversation_id') or request.args.get('conversationId')

    if conv_id:
        return get_conversation_messages(int(conv_id))
    if partner_id:
        return legacy_get_messages_by_partner(int(partner_id))
    return get_conversations()


@chat_bp.route('/users', methods=['GET'])
@jwt_required()
def list_chat_users():
    """Return only approved partners with whom the user has an active transaction."""
    user, err = _get_authenticated_user()
    if err:
        return err

    # Only return users with whom an existing conversation or request exists
    if user.role == 'donor':
        convs = Conversation.query.filter_by(donor_id=user.id).all()
        partner_ids = {c.receiver_id for c in convs}
        partners = User.query.filter(User.id.in_(partner_ids), User.status == 'approved').all() if partner_ids else []
    else:
        convs = Conversation.query.filter_by(receiver_id=user.id).all()
        partner_ids = {c.donor_id for c in convs}
        partners = User.query.filter(User.id.in_(partner_ids), User.status == 'approved').all() if partner_ids else []

    return jsonify([u.to_dict() for u in partners]), 200


@chat_bp.route('/conversations/<int:conv_id>/calls', methods=['GET'])
@jwt_required()
def get_conversation_calls(conv_id: int):
    """Retrieve call history for a conversation with authorization check."""
    user, err = _get_authenticated_user()
    if err:
        return err

    conv = Conversation.query.get(conv_id)
    if not conv:
        return jsonify({'success': False, 'message': 'Conversation not found'}), 404

    if user.id not in (conv.donor_id, conv.receiver_id):
        return jsonify({'success': False, 'message': 'Unauthorized to view calls in this conversation'}), 403

    calls = CallSession.query.filter_by(conversation_id=conv.id).order_by(CallSession.started_at.desc()).all()
    return jsonify({'success': True, 'calls': [c.to_dict() for c in calls]}), 200

