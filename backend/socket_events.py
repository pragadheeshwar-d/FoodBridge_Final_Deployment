"""
Socket.IO event handlers for real-time chat and room membership.
"""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from flask import request
from flask_jwt_extended import decode_token
from flask_socketio import emit, join_room, leave_room

from extensions import db, socketio
from models import CallSession, Conversation, Message, Notification, User
from services.realtime import emit_message, emit_notification

connected_users: dict[str, bool] = {}
user_sids: dict[str, set[str]] = {}
sid_users: dict[str, str] = {}
active_calls: dict[str, dict] = {}


def _join_authenticated_user(auth=None):
    token = None
    if auth and isinstance(auth, dict):
        token = auth.get('token')

    if not token and hasattr(request, 'args'):
        token = request.args.get('token')

    if not token:
        return None

    try:
        decoded = decode_token(token)
        user_id = str(decoded['sub'])
        sid = str(getattr(request, 'sid', ''))
        if sid:
            sid_users[sid] = user_id
            user_sids.setdefault(user_id, set()).add(sid)
        connected_users[user_id] = True
        join_room(f'user_{user_id}')
        return user_id
    except Exception:
        return None


@socketio.on('connect')
def handle_connect(auth=None):
    try:
        user_id = _join_authenticated_user(auth)
        if user_id:
            emit('connected', {'message': 'Authenticated', 'user_id': user_id})
        else:
            emit('connected', {'message': 'Connected (unauthenticated)'})
    except Exception:
        emit('connected', {'message': 'Connected (no token)'})


@socketio.on('disconnect')
def handle_disconnect():
    sid = str(getattr(request, 'sid', ''))
    user_id = sid_users.pop(sid, None)
    if user_id and user_id in user_sids:
        user_sids[user_id].discard(sid)
        if not user_sids[user_id]:
            user_sids.pop(user_id, None)
            connected_users.pop(user_id, None)

    # Clean up any active calls involving this user
    if user_id:
        for c_id, c_data in list(active_calls.items()):
            if c_data.get('caller_id') == int(user_id) or c_data.get('receiver_id') == int(user_id):
                partner_id = c_data['receiver_id'] if int(user_id) == c_data['caller_id'] else c_data['caller_id']
                emit('call:ended', {'call_id': c_id, 'reason': 'disconnected'}, room=f'user_{partner_id}')
                active_calls.pop(c_id, None)


@socketio.on('join_room')
@socketio.on('join')
def handle_join(data):
    user_id = str(data.get('user_id')) if isinstance(data, dict) and data.get('user_id') else None
    if user_id:
        sid = str(getattr(request, 'sid', ''))
        if sid:
            sid_users[sid] = user_id
            user_sids.setdefault(user_id, set()).add(sid)
        connected_users[user_id] = True
        join_room(f'user_{user_id}')
        emit('joined', {'room': f'user_{user_id}'})


@socketio.on('leave_room')
@socketio.on('leave')
def handle_leave(data):
    user_id = data.get('user_id') if isinstance(data, dict) else None
    if user_id:
        leave_room(f'user_{user_id}')


@socketio.on('send_message')
def handle_send_message(data):
    sender_id = data.get('sender_id')
    receiver_id = data.get('receiver_id')
    text = str(data.get('message', '')).strip()
    conv_id = data.get('conversation_id')

    if not all([sender_id, receiver_id, text]):
        emit('error', {'message': 'Missing required fields'})
        return

    from models import Conversation, User
    from datetime import datetime
    sender = User.query.get(int(sender_id))
    receiver = User.query.get(int(receiver_id))
    if not sender or not receiver:
        emit('error', {'message': 'Invalid sender or receiver'})
        return

    # Strictly Donor ↔ Receiver only
    if (sender.role == 'donor' and receiver.role != 'receiver') or (sender.role == 'receiver' and receiver.role != 'donor'):
        emit('error', {'message': 'Messaging is only permitted between a donor and receiver'})
        return

    conv = None
    if conv_id:
        conv = Conversation.query.get(int(conv_id))
    if not conv:
        donor_id = sender.id if sender.role == 'donor' else receiver.id
        recv_id = sender.id if sender.role == 'receiver' else receiver.id
        conv = Conversation.query.filter_by(donor_id=donor_id, receiver_id=recv_id).first()
        if not conv:
            from models import PickupRequest, Donation
            latest_pickup = (
                PickupRequest.query
                .join(Donation)
                .filter(Donation.donor_id == donor_id, PickupRequest.receiver_id == recv_id)
                .order_by(PickupRequest.requested_at.desc())
                .first()
            )
            conv = Conversation(
                donor_id=donor_id,
                receiver_id=recv_id,
                donation_id=latest_pickup.donation_id if latest_pickup else None,
                request_id=latest_pickup.id if latest_pickup else None,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.session.add(conv)
            db.session.flush()

    msg = Message(
        conversation_id=conv.id if conv else None,
        sender_id=int(sender_id),
        receiver_id=int(receiver_id),
        message=text,
        donation_id=conv.donation_id if conv else None,
        pickup_id=conv.request_id if conv else None
    )
    db.session.add(msg)
    if conv:
        conv.updated_at = datetime.utcnow()
    db.session.commit()

    msg_dict = msg.to_dict()
    emit_message([sender_id, receiver_id], msg_dict)



@socketio.on('mark_read')
def handle_mark_read(data):
    message_ids = data.get('message_ids', [])
    sender_id = data.get('sender_id')

    if message_ids:
        Message.query.filter(Message.id.in_(message_ids)).update({'is_read': True}, synchronize_session=False)
        db.session.commit()
        if sender_id:
            payload = {'message_ids': message_ids}
            emit('messages_read', payload, room=f'user_{sender_id}')
            emit('message_read', payload, room=f'user_{sender_id}')


@socketio.on('typing')
def handle_typing(data):
    receiver_id = data.get('receiver_id')
    sender_id = data.get('sender_id')
    if receiver_id:
        payload = {'user_id': sender_id}
        emit('user_typing', payload, room=f'user_{receiver_id}')
        emit('typing_indicator', payload, room=f'user_{receiver_id}')
        emit('userTyping', payload, room=f'user_{receiver_id}')


@socketio.on('stop_typing')
def handle_stop_typing(data):
    receiver_id = data.get('receiver_id')
    sender_id = data.get('sender_id')
    if receiver_id:
        payload = {'user_id': sender_id}
        emit('user_stop_typing', payload, room=f'user_{receiver_id}')
        emit('typing_indicator', {'user_id': sender_id, 'typing': False}, room=f'user_{receiver_id}')
        emit('userStoppedTyping', payload, room=f'user_{receiver_id}')


# =========================================================================
# WebRTC Audio Call Signaling Event Handlers
# =========================================================================

@socketio.on('call:initiate')
def handle_call_initiate(data):
    """Initiate an audio-only WebRTC call between donor and receiver."""
    sid = str(getattr(request, 'sid', ''))
    caller_id = sid_users.get(sid) or data.get('caller_id')
    conv_id = data.get('conversation_id')
    receiver_id = data.get('receiver_id')
    client_call_id = data.get('call_id') or f"call_{uuid4().hex[:12]}"

    if not caller_id or not conv_id or not receiver_id:
        emit('call:error', {'message': 'Missing required fields for call initiation'})
        return

    caller = User.query.get(int(caller_id))
    receiver = User.query.get(int(receiver_id))
    conv = Conversation.query.get(int(conv_id))

    if not caller or not receiver or not conv:
        emit('call:error', {'message': 'Invalid conversation or participant'})
        return

    # Security: Caller and receiver must strictly belong to this conversation
    if caller.id not in (conv.donor_id, conv.receiver_id) or receiver.id not in (conv.donor_id, conv.receiver_id):
        emit('call:error', {'message': 'Unauthorized to call in this conversation'})
        return

    caller_name = caller.organization or caller.name
    receiver_name = receiver.organization or receiver.name

    # Create new call session in database
    call = CallSession(
        call_id=client_call_id,
        conversation_id=conv.id,
        caller_id=caller.id,
        receiver_id=receiver.id,
        status='ringing',
        started_at=datetime.utcnow(),
    )
    db.session.add(call)
    db.session.commit()

    active_calls[client_call_id] = {
        'id': call.id,
        'call_id': client_call_id,
        'conversation_id': conv.id,
        'caller_id': caller.id,
        'receiver_id': receiver.id,
        'status': 'ringing',
        'started_at': datetime.utcnow(),
    }

    is_receiver_online = str(receiver.id) in user_sids or str(receiver.id) in connected_users

    if not is_receiver_online:
        call.status = 'missed'
        call.ended_at = datetime.utcnow()
        db.session.commit()
        active_calls.pop(client_call_id, None)

        try:
            notif = Notification(
                user_id=receiver.id,
                title="📞 Missed Audio Call",
                message=f"Missed audio call from {caller_name}",
                type='warning',
                link=f"/{receiver.role}/messages?conversationId={conv.id}",
            )
            db.session.add(notif)
            emit_notification(notif)
        except Exception:
            pass

        emit('call:error', {'message': f'{receiver_name} is currently offline.'})
        return

    call_payload = {
        'call_id': client_call_id,
        'conversation_id': conv.id,
        'caller_id': caller.id,
        'caller_name': caller_name,
        'caller_avatar': caller.profile_image,
        'caller_role': caller.role,
        'receiver_id': receiver.id,
        'receiver_name': receiver_name,
        'receiver_avatar': receiver.profile_image,
        'receiver_role': receiver.role,
        'online': True,
    }

    # Relay call:incoming to receiver's room
    emit('call:incoming', call_payload, room=f'user_{receiver.id}')

    # Acknowledge call initiation to caller
    emit('call:initiated', call_payload)


@socketio.on('call:accept')
def handle_call_accept(data):
    """Receiver accepted the call."""
    call_id = data.get('call_id')
    if not call_id:
        return

    call = CallSession.query.filter_by(call_id=call_id).first()
    if not call:
        return

    call.status = 'accepted'
    call.answered_at = datetime.utcnow()
    db.session.commit()

    if call_id in active_calls:
        active_calls[call_id]['status'] = 'accepted'
        active_calls[call_id]['answered_at'] = datetime.utcnow()

    emit('call:accepted', {'call_id': call_id, 'conversation_id': call.conversation_id}, room=f'user_{call.caller_id}')


@socketio.on('call:decline')
def handle_call_decline(data):
    """Receiver declined the incoming call."""
    call_id = data.get('call_id')
    if not call_id:
        return

    call = CallSession.query.filter_by(call_id=call_id).first()
    if not call:
        return

    call.status = 'declined'
    call.ended_at = datetime.utcnow()

    # System chat message in conversation
    msg = Message(
        conversation_id=call.conversation_id,
        sender_id=call.caller_id,
        receiver_id=call.receiver_id,
        message='📞 Audio call declined',
        message_type='call_system',
        call_session_id=call.id,
        is_read=True,
        created_at=datetime.utcnow(),
    )
    db.session.add(msg)
    db.session.commit()

    active_calls.pop(call_id, None)

    emit('call:declined', {'call_id': call_id}, room=f'user_{call.caller_id}')
    emit_message([call.caller_id, call.receiver_id], msg.to_dict())


@socketio.on('call:offer')
def handle_call_offer(data):
    """Relay WebRTC SDP offer from caller to receiver."""
    call_id = data.get('call_id')
    sdp = data.get('sdp')
    if not call_id or not sdp:
        return

    call_data = active_calls.get(call_id)
    receiver_id = call_data.get('receiver_id') if call_data else None
    if not receiver_id:
        call = CallSession.query.filter_by(call_id=call_id).first()
        if call:
            receiver_id = call.receiver_id

    if receiver_id:
        emit('call:offer', {'call_id': call_id, 'sdp': sdp}, room=f'user_{receiver_id}')


@socketio.on('call:answer')
def handle_call_answer(data):
    """Relay WebRTC SDP answer from receiver back to caller."""
    call_id = data.get('call_id')
    sdp = data.get('sdp')
    if not call_id or not sdp:
        return

    call_data = active_calls.get(call_id)
    caller_id = call_data.get('caller_id') if call_data else None
    if not caller_id:
        call = CallSession.query.filter_by(call_id=call_id).first()
        if call:
            caller_id = call.caller_id

    if caller_id:
        emit('call:answer', {'call_id': call_id, 'sdp': sdp}, room=f'user_{caller_id}')


@socketio.on('call:ice_candidate')
def handle_call_ice_candidate(data):
    """Relay WebRTC ICE candidate between peers without blocking on DB."""
    call_id = data.get('call_id')
    candidate = data.get('candidate')
    if not call_id or not candidate:
        return

    sid = str(getattr(request, 'sid', ''))
    sender_id = sid_users.get(sid) or data.get('sender_id')

    call_data = active_calls.get(call_id)
    caller_id = None
    receiver_id = None
    if call_data:
        caller_id = call_data.get('caller_id')
        receiver_id = call_data.get('receiver_id')
    else:
        call = CallSession.query.filter_by(call_id=call_id).first()
        if call:
            caller_id = call.caller_id
            receiver_id = call.receiver_id

    if caller_id and receiver_id:
        try:
            target_id = receiver_id if (sender_id and int(sender_id) == caller_id) else caller_id
            emit('call:ice_candidate', {'call_id': call_id, 'candidate': candidate}, room=f'user_{target_id}')
        except Exception:
            pass


@socketio.on('call:end')
def handle_call_end(data):
    """End the call, calculate duration, and record chat event & history."""
    call_id = data.get('call_id')
    duration = int(data.get('duration') or 0)
    reason = data.get('reason', 'ended')

    if not call_id:
        return

    call = CallSession.query.filter_by(call_id=call_id).first()
    if not call:
        return

    sid = str(getattr(request, 'sid', ''))
    user_id = sid_users.get(sid) or data.get('user_id')
    target_id = call.receiver_id if (user_id and int(user_id) == call.caller_id) else call.caller_id

    # If call was answered or duration was recorded, mark completed
    if call.answered_at or duration > 0 or call.status == 'accepted':
        call.status = 'completed'
        call.duration = duration
        call.ended_at = datetime.utcnow()
        minutes = duration // 60
        seconds = duration % 60
        chat_msg_text = f"📞 Audio call • {minutes:02d}:{seconds:02d}"
    else:
        call.status = 'missed'
        call.ended_at = datetime.utcnow()
        chat_msg_text = "📞 Missed audio call"

        # Create missed call notification for receiver
        try:
            caller = User.query.get(call.caller_id)
            receiver = User.query.get(call.receiver_id)
            if caller and receiver:
                caller_name = caller.organization or caller.name
                notif = Notification(
                    user_id=call.receiver_id,
                    title="📞 Missed Audio Call",
                    message=f"Missed audio call from {caller_name}",
                    type='warning',
                    link=f"/{receiver.role}/messages?conversationId={call.conversation_id}",
                )
                db.session.add(notif)
                emit_notification(notif)
        except Exception:
            pass

    msg = Message(
        conversation_id=call.conversation_id,
        sender_id=call.caller_id,
        receiver_id=call.receiver_id,
        message=chat_msg_text,
        message_type='call_system',
        call_session_id=call.id,
        is_read=True,
        created_at=datetime.utcnow(),
    )
    db.session.add(msg)
    db.session.commit()

    active_calls.pop(call_id, None)

    emit('call:ended', {'call_id': call_id, 'reason': reason}, room=f'user_{target_id}')
    emit_message([call.caller_id, call.receiver_id], msg.to_dict())


@socketio.on('call:timeout')
def handle_call_timeout(data):
    """Missed call due to ringing timeout (30 seconds)."""
    call_id = data.get('call_id')
    if not call_id:
        return

    call = CallSession.query.filter_by(call_id=call_id).first()
    if not call or call.status != 'ringing':
        return

    call.status = 'missed'
    call.ended_at = datetime.utcnow()

    msg = Message(
        conversation_id=call.conversation_id,
        sender_id=call.caller_id,
        receiver_id=call.receiver_id,
        message='📞 Missed audio call',
        message_type='call_system',
        call_session_id=call.id,
        is_read=True,
        created_at=datetime.utcnow(),
    )
    db.session.add(msg)

    try:
        caller = User.query.get(call.caller_id)
        receiver = User.query.get(call.receiver_id)
        if caller and receiver:
            caller_name = caller.organization or caller.name
            notif = Notification(
                user_id=call.receiver_id,
                title="📞 Missed Audio Call",
                message=f"Missed audio call from {caller_name}",
                type='warning',
                link=f"/{receiver.role}/messages?conversationId={call.conversation_id}",
            )
            db.session.add(notif)
            emit_notification(notif)
    except Exception:
        pass

    db.session.commit()
    active_calls.pop(call_id, None)

    emit('call:missed', {'call_id': call_id}, room=f'user_{call.receiver_id}')
    emit('call:ended', {'call_id': call_id, 'reason': 'timeout'}, room=f'user_{call.caller_id}')
    emit_message([call.caller_id, call.receiver_id], msg.to_dict())

