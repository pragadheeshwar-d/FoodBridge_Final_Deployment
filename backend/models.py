"""
SQLAlchemy ORM models for FoodBridge
"""
from datetime import datetime
from extensions import db


def _to_iso(dt):
    if not dt:
        return None
    val = dt.isoformat()
    return val if (val.endswith('Z') or '+' in val or '-' in val[10:]) else f"{val}Z"


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='donor', index=True)  # donor | receiver | admin | super_admin
    organization = db.Column(db.String(150), nullable=True)
    phone = db.Column(db.String(20), nullable=True)
    address = db.Column(db.String(255), nullable=True)
    profile_image = db.Column(db.Text, nullable=True)   # stores base64 or URL
    business_type = db.Column(db.String(50), nullable=True)
    verification_id = db.Column(db.String(100), nullable=True)  # govt reg ID for receivers
    operating_hours = db.Column(db.String(100), nullable=True)
    settings_json = db.Column(db.Text, nullable=True)

    # Account verification (email confirmation)
    verified = db.Column(db.Boolean, default=False, index=True)
    verification_token = db.Column(db.String(100), nullable=True)
    verification_expiry = db.Column(db.DateTime, nullable=True)

    # Admin approval status
    status = db.Column(db.String(20), default='pending', index=True)  # pending | approved | rejected | suspended
    approved_at = db.Column(db.DateTime, nullable=True)
    rejected_at = db.Column(db.DateTime, nullable=True)
    rejection_reason = db.Column(db.Text, nullable=True)
    phone_verified = db.Column(db.Boolean, default=False)
    org_verification_status = db.Column(db.String(20), default='NOT_SUBMITTED')

    # Password reset
    reset_token = db.Column(db.String(100), nullable=True)
    reset_expiry = db.Column(db.DateTime, nullable=True)
    
    account_status = db.Column(db.String(30), default='pending_admin')
    verification_status = db.Column(db.String(30), default='PENDING')

    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    # Relationships
    donations = db.relationship('Donation', backref='donor', lazy='dynamic',
                                foreign_keys='Donation.donor_id')
    pickup_requests = db.relationship('PickupRequest', backref='receiver', lazy='dynamic',
                                      foreign_keys='PickupRequest.receiver_id')
    notifications = db.relationship('Notification', backref='user', lazy='dynamic',
                                    foreign_keys='Notification.user_id')
    sent_messages = db.relationship('Message', backref='sender', lazy='dynamic',
                                    foreign_keys='Message.sender_id')
    received_messages = db.relationship('Message', backref='recipient', lazy='dynamic',
                                        foreign_keys='Message.receiver_id')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'role': self.role,
            'organization': self.organization,
            'phone': self.phone,
            'address': self.address,
            'profile_image': self.profile_image,
            'business_type': self.business_type,
            'verification_id': self.verification_id,
            'operating_hours': self.operating_hours,
            'verified': bool(self.verified),
            'email_verified': bool(self.verified),
            'status': self.status,
            'approval_status': self.status,
            'approved_at': self.approved_at.isoformat() if self.approved_at else None,
            'rejected_at': self.rejected_at.isoformat() if self.rejected_at else None,
            'rejection_reason': self.rejection_reason,
            'phone_verified': self.phone_verified,
            'org_verification_status': self.org_verification_status,
            'account_status': self.account_status,
            'verification_status': self.verification_status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def to_public_profile(self):
        successful_donations = Donation.query.filter_by(donor_id=self.id, status='Completed').count() if self.role == 'donor' else 0
        total_meals_donated = db.session.query(db.func.sum(Donation.quantity_number)).filter(Donation.donor_id == self.id, Donation.status == 'Completed').scalar() or 0 if self.role == 'donor' else 0
        active_donations_count = Donation.query.filter_by(donor_id=self.id, status='Available').count() if self.role == 'donor' else 0
        
        successful_pickups = PickupRequest.query.filter_by(receiver_id=self.id, status='Completed').count() if self.role == 'receiver' else 0
        active_needs_count = FoodNeed.query.filter_by(receiver_id=self.id, status='Open').count() if self.role == 'receiver' else 0

        general_location = self.address.split(',')[-2].strip() if self.address and len(self.address.split(',')) > 1 else (self.address or 'Tamil Nadu')

        return {
            'id': self.id,
            'name': self.name,
            'organization': self.organization,
            'role': self.role,
            'profile_image': self.profile_image,
            'business_type': self.business_type,
            'general_location': general_location,
            'verified': self.verified,
            'status': self.status,
            'member_since': self.created_at.strftime('%B %Y') if self.created_at else 'Recent',
            'successful_donations': int(successful_donations),
            'total_meals_donated': int(total_meals_donated),
            'active_donations_count': int(active_donations_count),
            'successful_pickups': int(successful_pickups),
            'active_needs_count': int(active_needs_count),
        }


class Donation(db.Model):
    __tablename__ = 'donations'

    id = db.Column(db.Integer, primary_key=True)
    donor_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    food_name = db.Column(db.String(150), nullable=False)
    food_type = db.Column(db.String(50), nullable=False)   # Cooked Rice, Curry, etc.
    category = db.Column(db.String(50), nullable=True)      # main, snacks, dessert, etc.
    veg_type = db.Column(db.String(20), nullable=True)      # veg | nonveg | vegan
    quantity = db.Column(db.String(50), nullable=False)     # "50 meals" or "10 kg"
    quantity_number = db.Column(db.Float, nullable=True)
    # Kept as a balance rather than recomputed in the UI. It is only changed by
    # the allocation service inside the same transaction as allocation history.
    remaining_quantity = db.Column(db.Float, nullable=True)
    unit = db.Column(db.String(20), nullable=True)          # meals | kg
    description = db.Column(db.Text, nullable=True)
    special_instructions = db.Column(db.Text, nullable=True)
    image = db.Column(db.Text, nullable=True)               # base64 or URL

    # Location
    pickup_address = db.Column(db.String(255), nullable=False)
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)

    # Timing
    pickup_time = db.Column(db.DateTime, nullable=True)
    expiry_time = db.Column(db.DateTime, nullable=False)
    preparation_time = db.Column(db.String(50), nullable=True)
    preferred_pickup_time = db.Column(db.String(50), nullable=True)
    storage_method = db.Column(db.String(50), nullable=True)
    current_temperature = db.Column(db.Float, nullable=True)

    # Legacy expiry-analysis fields retained for backward compatibility with older records
    predicted_expiry = db.Column(db.DateTime, nullable=True)
    freshness_score = db.Column(db.Integer, nullable=True)
    risk_level = db.Column(db.String(20), nullable=True)    # Green | Yellow | Red
    ai_recommendation = db.Column(db.Text, nullable=True)

    status = db.Column(db.String(50), default='Available')
    # Available | Requested | Approved | PARTIALLY_ALLOCATED | FULLY_ALLOCATED | Completed | Expired
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    pickup_requests = db.relationship('PickupRequest', backref='donation', lazy='dynamic',
                                      cascade='all, delete-orphan')
    allocations = db.relationship('Allocation', backref='donation', lazy='dynamic',
                                  cascade='all, delete-orphan')

    def to_dict(self, include_requests: bool = False):
        donor = User.query.get(self.donor_id)
        total_qty = float(self.quantity_number or 0.0)
        rem_qty = float(self.remaining_quantity) if self.remaining_quantity is not None else total_qty
        alloc_qty = max(0.0, total_qty - rem_qty)
        payload = {
            'id': self.id,
            'donor_id': self.donor_id,
            'donor_name': donor.name if donor else None,
            'donor_organization': donor.organization if donor else None,
            'food_name': self.food_name,
            'food_type': self.food_type,
            'category': self.category,
            'veg_type': self.veg_type,
            'quantity': self.quantity,
            'total_quantity': total_qty,
            'quantity_number': self.quantity_number,
            'allocated_quantity': alloc_qty,
            'remaining_quantity': rem_qty,
            'unit': self.unit,
            'description': self.description,
            'special_instructions': self.special_instructions,
            'image': self.image,
            'food_image': self.image,
            'pickup_address': self.pickup_address,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'pickup_time': self.pickup_time.isoformat() if self.pickup_time else None,
            'expiry_time': self.expiry_time.isoformat() if self.expiry_time else None,
            'preparation_time': self.preparation_time,
            'preferred_pickup_time': self.preferred_pickup_time,
            'storage_method': self.storage_method,
            'current_temperature': self.current_temperature,
            'predicted_expiry': self.predicted_expiry.isoformat() if self.predicted_expiry else None,
            'freshness_score': self.freshness_score,
            'risk_level': self.risk_level,
            'ai_recommendation': self.ai_recommendation,
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
        if include_requests:
            requests_list = []
            for pr in self.pickup_requests.order_by(PickupRequest.requested_at.asc()).all():
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
            payload['pickup_requests'] = requests_list
        return payload


class PickupRequest(db.Model):
    __tablename__ = 'pickup_requests'

    id = db.Column(db.Integer, primary_key=True)
    donation_id = db.Column(db.Integer, db.ForeignKey('donations.id', ondelete='CASCADE'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)

    status = db.Column(db.String(20), default='Pending')
    # Pending | Approved | Rejected | Completed
    request_message = db.Column(db.Text, nullable=True)
    requested_quantity = db.Column(db.Float, nullable=True)
    allocated_quantity = db.Column(db.Float, nullable=False, default=0)
    allocation_status = db.Column(db.String(30), nullable=True)  # WAITING | PARTIALLY_ALLOCATED | FULLY_ALLOCATED

    qr_token = db.Column(db.String(100), nullable=True, unique=True)
    qr_used = db.Column(db.Boolean, default=False)

    requested_at = db.Column(db.DateTime, default=datetime.utcnow)
    approved_at = db.Column(db.DateTime, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)
    allocations = db.relationship('Allocation', backref='pickup_request', lazy='dynamic',
                                  cascade='all, delete-orphan')

    def to_dict(self):
        donation = Donation.query.get(self.donation_id)
        receiver = User.query.get(self.receiver_id)
        qr = getattr(self, 'pickup_qr', None)
        return {
            'id': self.id,
            'donation_id': self.donation_id,
            'receiver_id': self.receiver_id,
            'receiver_name': receiver.name if receiver else None,
            'receiver_organization': receiver.organization if receiver else None,
            'request_message': self.request_message,
            'status': self.status,
            'requested_quantity': self.requested_quantity,
            'allocated_quantity': self.allocated_quantity or 0,
            'pending_quantity': max(0, (self.requested_quantity or 0) - (self.allocated_quantity or 0)),
            'allocation_status': self.allocation_status or 'WAITING',
            'qr_token': qr.qr_token if qr and qr.status == 'Active' else (self.qr_token if not self.qr_used else None),
            'qr_status': qr.status if qr else ('Used' if self.qr_used else None),
            'requested_at': self.requested_at.isoformat() if self.requested_at else None,
            'approved_at': self.approved_at.isoformat() if self.approved_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            # Include donation details for convenience
            'food_type': donation.food_name if donation else None,
            'quantity': self.requested_quantity if self.requested_quantity is not None else (donation.quantity_number if donation else None),
            'donation_quantity': donation.quantity_number if donation else None,
            'unit': donation.unit if donation else None,
            'pickup_address': donation.pickup_address if donation else None,
            'donor_name': donation.donor.name if donation and donation.donor else None,
            'donor_organization': donation.donor.organization if donation and donation.donor else None,
        }


class Allocation(db.Model):
    """Immutable quantity movement from a donation to a receiver request."""
    __tablename__ = 'allocations'

    id = db.Column(db.Integer, primary_key=True)
    pickup_request_id = db.Column(db.Integer, db.ForeignKey('pickup_requests.id', ondelete='CASCADE'), nullable=False, index=True)
    donation_id = db.Column(db.Integer, db.ForeignKey('donations.id', ondelete='CASCADE'), nullable=False, index=True)
    receiver_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    quantity = db.Column(db.Float, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class PickupQR(db.Model):
    __tablename__ = 'pickup_qr'

    id = db.Column(db.Integer, primary_key=True)
    pickup_request_id = db.Column(db.Integer, db.ForeignKey('pickup_requests.id', ondelete='CASCADE'), nullable=False, unique=True)
    qr_token = db.Column(db.String(100), nullable=False, unique=True, index=True)
    generated_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    scanned_at = db.Column(db.DateTime, nullable=True)
    status = db.Column(db.String(20), default='Active', nullable=False, index=True)

    pickup_request = db.relationship('PickupRequest', backref=db.backref('pickup_qr', uselist=False, cascade='all, delete-orphan'))

    def to_dict(self):
        return {
            'id': self.id,
            'pickup_request_id': self.pickup_request_id,
            'qr_token': self.qr_token,
            'generated_at': self.generated_at.isoformat() if self.generated_at else None,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'scanned_at': self.scanned_at.isoformat() if self.scanned_at else None,
            'status': self.status,
        }


class Notification(db.Model):
    __tablename__ = 'notifications'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    title = db.Column(db.String(150), nullable=False)
    message = db.Column(db.Text, nullable=False)
    type = db.Column(db.String(50), nullable=False, default='info')
    # new_donation | pickup_requested | pickup_approved | pickup_rejected |
    # pickup_completed | certificate_generated | info
    is_read = db.Column(db.Boolean, default=False)
    link = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'title': self.title,
            'message': self.message,
            'type': self.type,
            'is_read': self.is_read,
            'link': self.link,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Conversation(db.Model):
    __tablename__ = 'conversations'
    __table_args__ = (
        db.UniqueConstraint('donor_id', 'receiver_id', name='uq_donor_receiver_conv'),
    )

    id = db.Column(db.Integer, primary_key=True)
    donor_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    receiver_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    donation_id = db.Column(db.Integer, db.ForeignKey('donations.id', ondelete='SET NULL'), nullable=True, index=True)
    request_id = db.Column(db.Integer, db.ForeignKey('pickup_requests.id', ondelete='SET NULL'), nullable=True, index=True)
    need_id = db.Column(db.Integer, nullable=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)

    # Relationships
    donor = db.relationship('User', foreign_keys=[donor_id], backref=db.backref('donor_conversations', lazy='dynamic'))
    receiver = db.relationship('User', foreign_keys=[receiver_id], backref=db.backref('receiver_conversations', lazy='dynamic'))
    donation = db.relationship('Donation', foreign_keys=[donation_id], backref=db.backref('conversations', lazy='dynamic'))
    pickup_request = db.relationship('PickupRequest', foreign_keys=[request_id], backref=db.backref('conversations', lazy='dynamic'))
    messages = db.relationship('Message', backref='conversation', lazy='dynamic', cascade='all, delete-orphan')

    def to_dict(self, current_user_id=None):
        partner = self.receiver if current_user_id and int(current_user_id) == self.donor_id else self.donor
        current_user = self.donor if current_user_id and int(current_user_id) == self.donor_id else self.receiver

        # Dynamic last message
        last_msg = self.messages.order_by(Message.created_at.desc(), Message.id.desc()).first()

        # Dynamic unread count
        unread_count = 0
        if current_user_id:
            unread_count = self.messages.filter_by(receiver_id=int(current_user_id), is_read=False).count()

        donation_data = None
        pickup_data = None

        if self.donation:
            d = self.donation
            donation_data = {
                'id': d.id,
                'food_name': d.food_name,
                'food_type': d.food_type,
                'category': d.category,
                'veg_type': d.veg_type,
                'quantity': d.quantity,
                'quantity_number': d.quantity_number,
                'unit': d.unit,
                'status': d.status,
                'pickup_address': d.pickup_address,
                'pickup_time': d.pickup_time.isoformat() if d.pickup_time else None,
                'preferred_pickup_time': d.preferred_pickup_time,
                'expiry_time': d.expiry_time.isoformat() if d.expiry_time else None,
                'special_instructions': d.special_instructions,
                'image': d.image,
            }

        if self.pickup_request:
            p = self.pickup_request
            pickup_data = {
                'id': p.id,
                'status': p.status,
                'requested_quantity': p.requested_quantity,
                'allocated_quantity': p.allocated_quantity or 0,
                'allocation_status': p.allocation_status,
                'requested_at': p.requested_at.isoformat() if p.requested_at else None,
                'approved_at': p.approved_at.isoformat() if p.approved_at else None,
                'completed_at': p.completed_at.isoformat() if p.completed_at else None,
            }

        return {
            'id': self.id,
            'donor_id': self.donor_id,
            'receiver_id': self.receiver_id,
            'donation_id': self.donation_id,
            'request_id': self.request_id,
            'need_id': self.need_id,
            'partner': {
                'id': partner.id if partner else None,
                'name': (partner.organization or partner.name) if partner else 'Unknown Partner',
                'contact_name': partner.name if partner else None,
                'organization': partner.organization if partner else None,
                'role': partner.role if partner else 'receiver',
                'phone': partner.phone if partner else None,
                'address': partner.address if partner else None,
                'profile_image': partner.profile_image if partner else None,
                'verified': bool(partner.verified) if partner else False,
                'business_type': partner.business_type if partner else None,
            } if partner else None,
            'donation': donation_data,
            'pickup': pickup_data,
            'last_message': last_msg.to_dict() if last_msg else None,
            'unread_count': unread_count,
            'created_at': _to_iso(self.created_at),
            'updated_at': _to_iso(self.updated_at),
        }


class CallSession(db.Model):
    __tablename__ = 'call_sessions'

    id = db.Column(db.Integer, primary_key=True)
    call_id = db.Column(db.String(64), unique=True, nullable=False, index=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey('conversations.id', ondelete='CASCADE'), nullable=False, index=True)
    caller_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    receiver_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    status = db.Column(db.String(30), default='ringing', nullable=False, index=True)  # ringing, accepted, declined, missed, completed, failed
    started_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    answered_at = db.Column(db.DateTime, nullable=True)
    ended_at = db.Column(db.DateTime, nullable=True)
    duration = db.Column(db.Integer, default=0, nullable=False)  # in seconds

    # Relationships
    conversation = db.relationship('Conversation', foreign_keys=[conversation_id], backref=db.backref('call_sessions', lazy='dynamic', cascade='all, delete-orphan'))
    caller = db.relationship('User', foreign_keys=[caller_id], backref=db.backref('outgoing_calls', lazy='dynamic'))
    receiver = db.relationship('User', foreign_keys=[receiver_id], backref=db.backref('incoming_calls', lazy='dynamic'))

    def to_dict(self):
        caller = self.caller or User.query.get(self.caller_id)
        receiver = self.receiver or User.query.get(self.receiver_id)
        return {
            'id': self.id,
            'call_id': self.call_id,
            'conversation_id': self.conversation_id,
            'caller_id': self.caller_id,
            'receiver_id': self.receiver_id,
            'caller_name': (caller.organization or caller.name) if caller else 'Unknown Caller',
            'caller_avatar': caller.profile_image if caller else None,
            'receiver_name': (receiver.organization or receiver.name) if receiver else 'Unknown Receiver',
            'receiver_avatar': receiver.profile_image if receiver else None,
            'status': self.status,
            'started_at': _to_iso(self.started_at),
            'answered_at': _to_iso(self.answered_at),
            'ended_at': _to_iso(self.ended_at),
            'duration': self.duration,
        }


class Message(db.Model):
    __tablename__ = 'messages'

    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey('conversations.id', ondelete='CASCADE'), nullable=True, index=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    donation_id = db.Column(db.Integer, db.ForeignKey('donations.id', ondelete='SET NULL'), nullable=True)
    need_id = db.Column(db.Integer, nullable=True)
    pickup_id = db.Column(db.Integer, db.ForeignKey('pickup_requests.id', ondelete='SET NULL'), nullable=True)
    message = db.Column(db.Text, nullable=False)
    message_type = db.Column(db.String(30), default='text', nullable=True)
    call_session_id = db.Column(db.Integer, db.ForeignKey('call_sessions.id', ondelete='SET NULL'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    is_read = db.Column(db.Boolean, default=False)

    call_session = db.relationship('CallSession', foreign_keys=[call_session_id], backref=db.backref('system_messages', lazy='dynamic'))

    def to_dict(self):
        sender = User.query.get(self.sender_id)
        receiver = User.query.get(self.receiver_id)
        
        context_data = None
        if self.donation_id:
            d = Donation.query.get(self.donation_id)
            if d:
                context_data = {
                    'type': 'donation',
                    'id': d.id,
                    'title': d.food_name,
                    'quantity': d.quantity,
                    'status': d.status,
                    'pickup_address': d.pickup_address,
                }
        elif self.need_id:
            n = FoodNeed.query.get(self.need_id)
            if n:
                context_data = {
                    'type': 'need',
                    'id': n.id,
                    'title': n.food_name or n.food_type,
                    'quantity': n.required_quantity,
                    'status': n.status,
                }
        elif self.pickup_id:
            p = PickupRequest.query.get(self.pickup_id)
            if p and p.donation:
                context_data = {
                    'type': 'pickup',
                    'id': p.id,
                    'title': p.donation.food_name,
                    'quantity': f"{p.requested_quantity} {p.donation.unit or 'servings'}",
                    'status': p.status,
                    'pickup_address': p.donation.pickup_address,
                }

        is_call_msg = (self.message_type == 'call_system') or (bool(self.message and self.message.startswith('📞')))

        return {
            'id': self.id,
            'conversation_id': self.conversation_id,
            'sender_id': self.sender_id,
            'receiver_id': self.receiver_id,
            'sender_name': sender.name if sender else None,
            'receiver_name': receiver.name if receiver else None,
            'sender_role': sender.role if sender else None,
            'receiver_role': receiver.role if receiver else None,
            'message': self.message,
            'message_type': 'call_system' if is_call_msg else (self.message_type or 'text'),
            'call_session_id': self.call_session_id,
            'call_status': self.call_session.status if self.call_session else None,
            'call_duration': self.call_session.duration if self.call_session else None,
            'donation_id': self.donation_id,
            'need_id': self.need_id,
            'pickup_id': self.pickup_id,
            'context': context_data,
            'created_at': _to_iso(self.created_at),
            'is_read': bool(self.is_read),
        }



class FoodNeed(db.Model):
    __tablename__ = 'food_needs'

    id = db.Column(db.Integer, primary_key=True)
    receiver_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    food_type = db.Column(db.String(100), nullable=False)   # Rice / Biryani / Meals / Bread / etc.
    food_name = db.Column(db.String(150), nullable=True)
    required_quantity = db.Column(db.String(50), nullable=False)  # "50 servings"
    quantity_number = db.Column(db.Float, nullable=False, default=1.0)
    remaining_quantity = db.Column(db.Float, nullable=True)
    unit = db.Column(db.String(20), default='servings')     # servings | meals | kg
    urgency = db.Column(db.String(20), default='Medium')    # Low | Medium | High | Critical
    location = db.Column(db.String(255), nullable=False)
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)
    required_time = db.Column(db.DateTime, nullable=False)
    additional_notes = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(30), default='Open', index=True) # Open | Partially Fulfilled | Fulfilled | Cancelled
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    receiver = db.relationship('User', foreign_keys=[receiver_id], backref=db.backref('food_needs', lazy='dynamic'))
    responses = db.relationship('FoodNeedResponse', backref='need', lazy='dynamic', cascade='all, delete-orphan')

    def to_dict(self):
        receiver = self.receiver or User.query.get(self.receiver_id)
        responses_list = [r.to_dict() for r in self.responses.all()]
        return {
            'id': self.id,
            'receiver_id': self.receiver_id,
            'receiver_name': receiver.name if receiver else 'Anonymous NGO',
            'receiver_organization': receiver.organization if receiver else None,
            'receiver_avatar': receiver.profile_image if receiver else None,
            'food_type': self.food_type,
            'food_name': self.food_name or self.food_type,
            'required_quantity': self.required_quantity,
            'quantity_number': self.quantity_number,
            'remaining_quantity': self.remaining_quantity if self.remaining_quantity is not None else self.quantity_number,
            'unit': self.unit,
            'urgency': self.urgency,
            'location': self.location,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'required_time': self.required_time.isoformat() if self.required_time else None,
            'additional_notes': self.additional_notes,
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'responses_count': len(responses_list),
            'responses': responses_list,
        }


class FoodNeedResponse(db.Model):
    __tablename__ = 'food_need_responses'

    id = db.Column(db.Integer, primary_key=True)
    need_id = db.Column(db.Integer, db.ForeignKey('food_needs.id', ondelete='CASCADE'), nullable=False, index=True)
    donor_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    offered_quantity = db.Column(db.Float, nullable=False)
    unit = db.Column(db.String(20), default='servings')
    delivery_type = db.Column(db.String(30), default='Pickup by NGO') # Pickup by NGO | Delivery by Donor
    message = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), default='Pending', index=True) # Pending | Accepted | Declined | Completed
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    donor = db.relationship('User', foreign_keys=[donor_id], backref=db.backref('need_responses', lazy='dynamic'))

    def to_dict(self):
        donor = self.donor or User.query.get(self.donor_id)
        return {
            'id': self.id,
            'need_id': self.need_id,
            'donor_id': self.donor_id,
            'donor_name': donor.name if donor else 'Anonymous Donor',
            'donor_organization': donor.organization if donor else None,
            'donor_avatar': donor.profile_image if donor else None,
            'offered_quantity': self.offered_quantity,
            'unit': self.unit,
            'delivery_type': self.delivery_type,
            'message': self.message,
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Certificate(db.Model):
    __tablename__ = 'certificates'

    id = db.Column(db.Integer, primary_key=True)
    donation_id = db.Column(db.Integer, db.ForeignKey('donations.id', ondelete='CASCADE'), nullable=False)
    donor_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    certificate_url = db.Column(db.String(255), nullable=True)
    generated_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        donation = Donation.query.get(self.donation_id)
        donor = User.query.get(self.donor_id)
        receiver = User.query.get(self.receiver_id)
        return {
            'id': self.id,
            'donation_id': self.donation_id,
            'donor_id': self.donor_id,
            'receiver_id': self.receiver_id,
            'certificate_url': self.certificate_url,
            'generated_at': self.generated_at.isoformat() if self.generated_at else None,
            'donation': donation.to_dict() if donation else None,
            'donor_name': donor.name if donor else None,
            'donor_organization': donor.organization if donor else None,
            'receiver_name': receiver.name if receiver else None,
            'receiver_organization': receiver.organization if receiver else None,
        }


class OrganizationVerification(db.Model):
    __tablename__ = 'organization_verifications'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    organization_type = db.Column(db.String(50), nullable=True)
    verification_status = db.Column(db.String(20), default='NOT_SUBMITTED', nullable=False, index=True)
    verification_method = db.Column(db.String(50), nullable=True)
    government_id_type = db.Column(db.String(50), nullable=True)
    government_id_number = db.Column(db.String(100), nullable=True)
    document_url = db.Column(db.String(255), nullable=True)
    submitted_at = db.Column(db.DateTime, nullable=True)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    reviewed_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    rejection_reason = db.Column(db.Text, nullable=True)
    provider_name = db.Column(db.String(50))
    match_result = db.Column(db.String(50))
    failure_reason = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = db.relationship('User', foreign_keys=[user_id], backref=db.backref('org_verifications', lazy='dynamic'))
    reviewer = db.relationship('User', foreign_keys=[reviewed_by])

    def to_dict(self, mask_id=True):
        masked_id = None
        if self.government_id_number:
            masked_id = '********' + self.government_id_number[-4:] if len(self.government_id_number) > 4 else '****'
        return {
            'id': self.id,
            'user_id': self.user_id,
            'organization_type': self.organization_type,
            'verification_status': self.verification_status,
            'verification_method': self.verification_method,
            'government_id_type': self.government_id_type,
            'government_id_number': masked_id if mask_id else self.government_id_number,
            'document_url': f'/api/verification/document/{self.id}' if self.document_url else None,
            'submitted_at': self.submitted_at.isoformat() if self.submitted_at else None,
            'reviewed_at': self.reviewed_at.isoformat() if self.reviewed_at else None,
            'reviewed_by': self.reviewed_by,
            'rejection_reason': self.rejection_reason,
            'provider_name': self.provider_name,
            'match_result': self.match_result,
            'failure_reason': self.failure_reason,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class VerificationAuditLog(db.Model):
    __tablename__ = 'verification_audit_logs'

    id = db.Column(db.Integer, primary_key=True)
    verification_id = db.Column(db.Integer, db.ForeignKey('organization_verifications.id', ondelete='CASCADE'), nullable=False, index=True)
    action = db.Column(db.String(30), nullable=False)
    actor_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    details = db.Column(db.Text, nullable=True)

    verification = db.relationship('OrganizationVerification', backref=db.backref('audit_logs', lazy='dynamic'))


class PhoneVerification(db.Model):
    __tablename__ = 'phone_verifications'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    phone = db.Column(db.String(20), nullable=False)
    otp_code = db.Column(db.String(6), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    verified = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class FSSAIVerification(db.Model):
    __tablename__ = 'fssai_verifications'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    organization_name_submitted = db.Column(db.String(150), nullable=False)
    license_number = db.Column(db.String(50), nullable=False, index=True)
    provider = db.Column(db.String(50), nullable=False) # 'authbridge' or 'mock'
    provider_reference_id = db.Column(db.String(100), nullable=True)
    verified_business_name = db.Column(db.String(150), nullable=True)
    license_status = db.Column(db.String(50), nullable=True)
    valid_from = db.Column(db.DateTime, nullable=True)
    valid_until = db.Column(db.DateTime, nullable=True)
    verified_address = db.Column(db.Text, nullable=True)
    
    name_match_score = db.Column(db.Float, nullable=True)
    address_match_score = db.Column(db.Float, nullable=True)
    verification_score = db.Column(db.Float, nullable=True)
    
    verification_status = db.Column(db.String(30), nullable=False, index=True) # PENDING, VERIFYING, VERIFIED, MANUAL_REVIEW, REJECTED, EXPIRED, API_ERROR
    failure_reason = db.Column(db.Text, nullable=True)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    user = db.relationship('User', foreign_keys=[user_id], backref=db.backref('fssai_verifications_history', lazy='dynamic'))

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'organization_name_submitted': self.organization_name_submitted,
            'license_number': self.license_number,
            'provider': self.provider,
            'provider_reference_id': self.provider_reference_id,
            'verified_business_name': self.verified_business_name,
            'license_status': self.license_status,
            'valid_from': self.valid_from.isoformat() if self.valid_from else None,
            'valid_until': self.valid_until.isoformat() if self.valid_until else None,
            'verified_address': self.verified_address,
            'name_match_score': self.name_match_score,
            'address_match_score': self.address_match_score,
            'verification_score': self.verification_score,
            'verification_status': self.verification_status,
            'failure_reason': self.failure_reason,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

