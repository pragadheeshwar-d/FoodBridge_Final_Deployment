"""
FoodBridge Flask application factory.
"""

from __future__ import annotations

import json
import logging
import os
import re
from uuid import uuid4
from logging.handlers import RotatingFileHandler

from flask import Flask, jsonify, send_from_directory
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from config import Config
from extensions import cors, db, jwt, mail, migrate, socketio


def ensure_mysql_database_exists(database_url: str) -> None:
    if not database_url.startswith('mysql'):
        return

    url = make_url(database_url)
    if not url.database:
        return

    admin_url = url.set(database=None)
    engine = create_engine(admin_url, isolation_level='AUTOCOMMIT')
    with engine.connect() as connection:
        connection.exec_driver_sql(
            f"CREATE DATABASE IF NOT EXISTS `{url.database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
        )


def api_response(*, success: bool, message: str = 'Success', data=None, status: int = 200, **extra):
    payload = {'success': success, 'message': message}
    if data is not None:
        payload['data'] = data
    payload.update(extra)
    return jsonify(payload), status


def seed_admin_user(app: Flask) -> None:
    from models import User  # Local import to avoid circular dependency

    admin_emails = list(dict.fromkeys([
        app.config.get('ADMIN_EMAIL', 'admin@foodbridge.org').strip().lower(),
        'admin@foodbridge.org',
        'admin@foodbridge.com',
    ]))
    admin_password = app.config.get('ADMIN_PASSWORD', 'Admin@123')
    admin_name = app.config.get('ADMIN_NAME', 'FoodBridge Admin')

    with app.app_context():
        from bcrypt import gensalt, hashpw
        hashed = hashpw(admin_password.encode('utf-8'), gensalt()).decode('utf-8')
        for email in admin_emails:
            if not email:
                continue
            existing = User.query.filter_by(email=email).first()
            if existing:
                existing.password = hashed
                if existing.role != 'admin':
                    existing.role = 'admin'
                if not existing.verified:
                    existing.verified = True
                if existing.status != 'approved':
                    existing.status = 'approved'
            else:
                admin = User(
                    name=admin_name,
                    email=email,
                    password=hashed,
                    role='admin',
                    organization='FoodBridge',
                    verified=True,
                    status='approved',
                )
                db.session.add(admin)
        # Seed Demo Donor
        donor_email = 'donor@foodbridge.org'
        existing_donor = User.query.filter_by(email=donor_email).first()
        donor_hashed = hashpw('Donor@123'.encode('utf-8'), gensalt()).decode('utf-8')
        if existing_donor:
            existing_donor.password = donor_hashed
            existing_donor.verified = True
            existing_donor.status = 'approved'
            existing_donor.account_status = 'approved'
            existing_donor.verification_status = 'VERIFIED'
        else:
            donor = User(
                name='Annapoorna Kitchen',
                email=donor_email,
                password=donor_hashed,
                role='donor',
                organization='Annapoorna Caterers',
                phone='9876543210',
                address='T. Nagar, Chennai',
                verified=True,
                status='approved',
                account_status='approved',
                verification_status='VERIFIED',
            )
            db.session.add(donor)

        # Seed Demo Receiver
        receiver_email = 'receiver@foodbridge.org'
        existing_receiver = User.query.filter_by(email=receiver_email).first()
        receiver_hashed = hashpw('Receiver@123'.encode('utf-8'), gensalt()).decode('utf-8')
        if existing_receiver:
            existing_receiver.password = receiver_hashed
            existing_receiver.verified = True
            existing_receiver.status = 'approved'
            existing_receiver.account_status = 'approved'
            existing_receiver.verification_status = 'VERIFIED'
        else:
            receiver = User(
                name='Aadhavan Trust',
                email=receiver_email,
                password=receiver_hashed,
                role='receiver',
                organization='Aadhavan Shelter',
                phone='9876543211',
                address='Adyar, Chennai',
                verified=True,
                status='approved',
                account_status='approved',
                verification_status='VERIFIED',
            )
            db.session.add(receiver)
        db.session.commit()


def auto_verify_all_users(app: Flask) -> None:
    from models import User

    with app.app_context():
        try:
            users = User.query.all()
            for u in users:
                u.verified = True
                if u.status == 'pending':
                    u.status = 'approved'
                if getattr(u, 'account_status', None) == 'pending' or not getattr(u, 'account_status', None):
                    u.account_status = 'approved'
                u.verification_status = 'VERIFIED'
            db.session.commit()
        except Exception as e:
            app.logger.warning(f'Could not auto-verify existing users: {e}')


def ensure_phase2_schema(app: Flask) -> None:
    from sqlalchemy import inspect

    with app.app_context():
        inspector = inspect(db.engine)
        if 'pickup_requests' not in inspector.get_table_names():
            return

        columns = {column['name'] for column in inspector.get_columns('pickup_requests')}
        if 'request_message' not in columns:
            db.session.execute(text('ALTER TABLE pickup_requests ADD COLUMN request_message TEXT NULL'))
            db.session.commit()


def ensure_phase3_schema(app: Flask) -> None:
    from sqlalchemy import inspect

    with app.app_context():
        inspector = inspect(db.engine)
        table_columns = {
            'users': {'settings_json': 'TEXT NULL'},
            'donations': {
                'quantity_number': 'FLOAT NULL',
                'unit': 'VARCHAR(20) NULL',
                'category': 'VARCHAR(50) NULL',
                'veg_type': 'VARCHAR(20) NULL',
                'special_instructions': 'TEXT NULL',
                'preparation_time': 'VARCHAR(50) NULL',
                'preferred_pickup_time': 'VARCHAR(50) NULL',
                'storage_method': 'VARCHAR(50) NULL',
                'current_temperature': 'FLOAT NULL',
                'predicted_expiry': 'DATETIME NULL',
                'freshness_score': 'INT NULL',
                'risk_level': 'VARCHAR(20) NULL',
                'ai_recommendation': 'TEXT NULL',
            },
        }
        for table_name, columns in table_columns.items():
            if table_name not in inspector.get_table_names():
                continue
            existing = {column['name'] for column in inspector.get_columns(table_name)}
            for column_name, ddl in columns.items():
                if column_name not in existing:
                    db.session.execute(text(f'ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}'))
                db.session.commit()


def ensure_allocation_schema(app: Flask) -> None:
    """Small additive upgrade for existing deployments (create_all covers new DBs)."""
    from sqlalchemy import inspect
    with app.app_context():
        inspector = inspect(db.engine)
        additions = {
            'donations': {'remaining_quantity': 'FLOAT NULL'},
            'pickup_requests': {
                'requested_quantity': 'FLOAT NULL', 'allocated_quantity': 'FLOAT NOT NULL DEFAULT 0',
                'allocation_status': 'VARCHAR(30) NULL',
            },
        }
        for table, columns in additions.items():
            if table not in inspector.get_table_names():
                continue
            present = {c['name'] for c in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name not in present:
                    db.session.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {ddl}'))
        try:
            if db.engine.dialect.name == 'mysql':
                db.session.execute(text("ALTER TABLE donations MODIFY COLUMN status VARCHAR(50) DEFAULT 'Available'"))
            elif db.engine.dialect.name == 'postgresql':
                db.session.execute(text("ALTER TABLE donations ALTER COLUMN status TYPE VARCHAR(50)"))
        except Exception:
            pass
        db.session.execute(text('UPDATE donations SET remaining_quantity = quantity_number WHERE remaining_quantity IS NULL'))
        db.session.commit()


def ensure_verification_schema(app: Flask) -> None:
    from sqlalchemy import inspect
    with app.app_context():
        inspector = inspect(db.engine)
        if 'users' not in inspector.get_table_names():
            return
        
        columns = {column['name'] for column in inspector.get_columns('users')}
        if 'phone_verified' not in columns:
            db.session.execute(text('ALTER TABLE users ADD COLUMN phone_verified BOOLEAN DEFAULT 0'))
            db.session.commit()
            
        if 'org_verification_status' not in columns:
            db.session.execute(text("ALTER TABLE users ADD COLUMN org_verification_status VARCHAR(20) DEFAULT 'NOT_SUBMITTED'"))
            db.session.commit()


def ensure_automated_verification_schema(app: Flask) -> None:
    from sqlalchemy import inspect
    with app.app_context():
        inspector = inspect(db.engine)
        if 'users' in inspector.get_table_names():
            columns = {column['name'] for column in inspector.get_columns('users')}
            if 'account_status' not in columns:
                db.session.execute(text("ALTER TABLE users ADD COLUMN account_status VARCHAR(30) DEFAULT 'PENDING_VERIFICATION'"))
            if 'verification_status' not in columns:
                db.session.execute(text("ALTER TABLE users ADD COLUMN verification_status VARCHAR(30) DEFAULT 'PENDING'"))
            db.session.commit()
            
        if 'organization_verifications' in inspector.get_table_names():
            columns = {column['name'] for column in inspector.get_columns('organization_verifications')}
            if 'provider_name' not in columns:
                db.session.execute(text("ALTER TABLE organization_verifications ADD COLUMN provider_name VARCHAR(50)"))
            if 'match_result' not in columns:
                db.session.execute(text("ALTER TABLE organization_verifications ADD COLUMN match_result VARCHAR(50)"))
            if 'failure_reason' not in columns:
                db.session.execute(text("ALTER TABLE organization_verifications ADD COLUMN failure_reason TEXT"))
            db.session.commit()


def ensure_admin_approval_schema(app: Flask) -> None:
    from sqlalchemy import inspect
    with app.app_context():
        inspector = inspect(db.engine)
        if 'users' in inspector.get_table_names():
            columns = {column['name'] for column in inspector.get_columns('users')}
            if 'approved_at' not in columns:
                db.session.execute(text("ALTER TABLE users ADD COLUMN approved_at DATETIME NULL"))
            if 'rejected_at' not in columns:
                db.session.execute(text("ALTER TABLE users ADD COLUMN rejected_at DATETIME NULL"))
            if 'rejection_reason' not in columns:
                db.session.execute(text("ALTER TABLE users ADD COLUMN rejection_reason TEXT NULL"))
            db.session.commit()


def ensure_two_way_bridge_schema(app: Flask) -> None:
    from sqlalchemy import inspect
    with app.app_context():
        inspector = inspect(db.engine)
        if 'messages' in inspector.get_table_names():
            columns = {column['name'] for column in inspector.get_columns('messages')}
            if 'donation_id' not in columns:
                try:
                    db.session.execute(text("ALTER TABLE messages ADD COLUMN donation_id INT NULL"))
                except Exception:
                    pass
            if 'need_id' not in columns:
                try:
                    db.session.execute(text("ALTER TABLE messages ADD COLUMN need_id INT NULL"))
                except Exception:
                    pass
            if 'pickup_id' not in columns:
                try:
                    db.session.execute(text("ALTER TABLE messages ADD COLUMN pickup_id INT NULL"))
                except Exception:
                    pass
            db.session.commit()


def ensure_conversation_schema(app: Flask) -> None:
    from sqlalchemy import inspect, or_, and_
    from datetime import datetime
    with app.app_context():
        from models import Conversation, Message, PickupRequest, Donation
        inspector = inspect(db.engine)
        table_names = inspector.get_table_names()

        if 'conversations' not in table_names:
            try:
                Conversation.__table__.create(db.engine, checkfirst=True)
            except Exception as e:
                app.logger.warning(f"Failed to create conversations table: {e}")

        if 'messages' in table_names:
            columns = {column['name'] for column in inspector.get_columns('messages')}
            if 'conversation_id' not in columns:
                try:
                    db.session.execute(text("ALTER TABLE messages ADD COLUMN conversation_id INT NULL"))
                    db.session.commit()
                except Exception as e:
                    app.logger.warning(f"Failed to add conversation_id to messages: {e}")

        # 1. Deduplicate existing conversations: strictly ONE conversation per (donor_id, receiver_id)
        try:
            all_convs = Conversation.query.order_by(Conversation.updated_at.desc(), Conversation.id.desc()).all()
            grouped = {}
            for c in all_convs:
                pair = (c.donor_id, c.receiver_id)
                if pair not in grouped:
                    grouped[pair] = []
                grouped[pair].append(c)

            for (d_id, r_id), conv_list in grouped.items():
                if len(conv_list) > 1:
                    canonical = conv_list[0]
                    # Find latest pickup request between them to ensure latest transaction context
                    latest_pickup = (
                        PickupRequest.query
                        .join(Donation)
                        .filter(Donation.donor_id == d_id, PickupRequest.receiver_id == r_id)
                        .order_by(PickupRequest.requested_at.desc(), PickupRequest.id.desc())
                        .first()
                    )
                    if latest_pickup:
                        canonical.donation_id = latest_pickup.donation_id
                        canonical.request_id = latest_pickup.id

                    for duplicate in conv_list[1:]:
                        Message.query.filter_by(conversation_id=duplicate.id).update(
                            {'conversation_id': canonical.id},
                            synchronize_session=False
                        )
                        db.session.delete(duplicate)
                    db.session.commit()

            # Ensure unique index on (donor_id, receiver_id)
            if 'conversations' in inspector.get_table_names():
                indices = [idx['name'] for idx in inspector.get_indexes('conversations')]
                if 'uq_donor_receiver_conv' not in indices and 'uq_conversations_donor_receiver' not in indices:
                    try:
                        db.session.execute(text("CREATE UNIQUE INDEX uq_donor_receiver_conv ON conversations (donor_id, receiver_id)"))
                        db.session.commit()
                    except Exception as idx_err:
                        app.logger.info(f"Unique index notice: {idx_err}")
                        db.session.rollback()

            # 2. Backfill conversations from pickup requests: strictly ONE conversation per (donor_id, receiver_id)
            pickups = PickupRequest.query.order_by(PickupRequest.requested_at.asc(), PickupRequest.id.asc()).all()
            for pickup in pickups:
                donation = pickup.donation
                if not donation or not donation.donor_id or not pickup.receiver_id:
                    continue
                conv = Conversation.query.filter_by(
                    donor_id=donation.donor_id,
                    receiver_id=pickup.receiver_id,
                ).first()
                if not conv:
                    conv = Conversation(
                        donor_id=donation.donor_id,
                        receiver_id=pickup.receiver_id,
                        donation_id=donation.id,
                        request_id=pickup.id,
                        created_at=pickup.requested_at or datetime.utcnow(),
                        updated_at=pickup.completed_at or pickup.approved_at or pickup.requested_at or datetime.utcnow(),
                    )
                    db.session.add(conv)
                else:
                    conv.donation_id = donation.id
                    conv.request_id = pickup.id
                    pickup_time = pickup.completed_at or pickup.approved_at or pickup.requested_at
                    if pickup_time and (not conv.updated_at or pickup_time > conv.updated_at):
                        conv.updated_at = pickup_time
            db.session.commit()

            # 3. Backfill unlinked messages
            unlinked_msgs = Message.query.filter(Message.conversation_id.is_(None)).all()
            for msg in unlinked_msgs:
                conv = Conversation.query.filter(
                    or_(
                        and_(Conversation.donor_id == msg.sender_id, Conversation.receiver_id == msg.receiver_id),
                        and_(Conversation.donor_id == msg.receiver_id, Conversation.receiver_id == msg.sender_id)
                    )
                ).order_by(Conversation.updated_at.desc()).first()
                if conv:
                    msg.conversation_id = conv.id
            db.session.commit()
        except Exception as e:
            app.logger.warning(f"Error backfilling/deduplicating conversations: {e}")
            db.session.rollback()


def ensure_call_schema(app: Flask) -> None:
    from sqlalchemy import inspect
    with app.app_context():
        from models import CallSession
        inspector = inspect(db.engine)
        table_names = inspector.get_table_names()

        if 'call_sessions' not in table_names:
            try:
                CallSession.__table__.create(db.engine, checkfirst=True)
            except Exception as e:
                app.logger.warning(f"Failed to create call_sessions table: {e}")

        if 'messages' in table_names:
            columns = {column['name'] for column in inspector.get_columns('messages')}
            if 'message_type' not in columns:
                try:
                    db.session.execute(text("ALTER TABLE messages ADD COLUMN message_type VARCHAR(30) DEFAULT 'text'"))
                    db.session.commit()
                except Exception as e:
                    app.logger.warning(f"Failed to add message_type to messages: {e}")
                    db.session.rollback()

            if 'call_session_id' not in columns:
                try:
                    db.session.execute(text("ALTER TABLE messages ADD COLUMN call_session_id INT NULL"))
                    db.session.commit()
                except Exception as e:
                    app.logger.warning(f"Failed to add call_session_id to messages: {e}")
                    db.session.rollback()


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    os.makedirs(app.config['PROFILE_UPLOAD_FOLDER'], exist_ok=True)
    os.makedirs(app.config['DONATION_UPLOAD_FOLDER'], exist_ok=True)
    os.makedirs(app.config['CERTIFICATE_UPLOAD_FOLDER'], exist_ok=True)
    os.makedirs(app.config['VERIFICATION_UPLOAD_FOLDER'], exist_ok=True)
    os.makedirs(app.config['LOG_FOLDER'], exist_ok=True)

    ensure_mysql_database_exists(app.config['SQLALCHEMY_DATABASE_URI'])

    allowed_origins = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:5180',
        'http://127.0.0.1:5180',
        'http://localhost:5190',
        'http://127.0.0.1:5190',
        'http://localhost:4173',
        'http://127.0.0.1:4173',
        'http://localhost:3000',
        re.compile(r'^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$'),
        re.compile(r'^https:\/\/.*\.vercel\.app$'),
    ]
    frontend_url = os.environ.get('FRONTEND_URL')
    if frontend_url and frontend_url not in allowed_origins:
        allowed_origins.append(frontend_url)

    db.init_app(app)
    jwt.init_app(app)
    mail.init_app(app)
    migrate.init_app(app, db)
    cors.init_app(app, resources={r'/api/*': {'origins': allowed_origins}}, supports_credentials=True)
    socketio.init_app(
        app,
        cors_allowed_origins='*',
        logger=False,
        engineio_logger=False,
        async_mode='threading',
    )

    log_file = os.path.join(app.config['LOG_FOLDER'], 'foodbridge.log')
    if not any(isinstance(handler, RotatingFileHandler) for handler in app.logger.handlers):
        file_handler = RotatingFileHandler(log_file, maxBytes=1_000_000, backupCount=3)
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s'))
        app.logger.addHandler(file_handler)
        app.logger.setLevel(logging.INFO)

    from routes.admin import admin_bp
    from routes.auth import (
        auth_bp,
        auth_check,
        change_password,
        get_profile,
        login,
        logout,
        register,
        update_profile,
        upload_profile_image,
    )
    from routes.chat import chat_bp, get_messages_or_conversations, send_message
    from routes.dashboard import dashboard_bp
    from routes.donations import donations_bp
    from routes.food_needs import needs_bp
    from routes.notifications import notifications_bp
    from routes.pickups import pickups_bp, create_pickup_request, list_pickup_requests, update_pickup_request, confirm_pickup_receipt
    from routes.services import api_generate_qr, api_get_qr, api_verify_qr, services_bp
    from routes.verification import verification_bp
    from routes.fssai_routes import fssai_bp

    app.register_blueprint(admin_bp, url_prefix='/api/admin')
    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(donations_bp, url_prefix='/api/donations')
    app.register_blueprint(needs_bp, url_prefix='/api/needs')
    app.register_blueprint(pickups_bp, url_prefix='/api/pickups')
    app.register_blueprint(dashboard_bp, url_prefix='/api/dashboard')
    app.register_blueprint(notifications_bp, url_prefix='/api/notifications')
    app.register_blueprint(chat_bp, url_prefix='/api/chat')
    app.register_blueprint(services_bp, url_prefix='/api/services')
    app.register_blueprint(verification_bp, url_prefix='/api/verification')
    app.register_blueprint(fssai_bp, url_prefix='/api/verification/fssai')

    # Compatibility aliases requested by the brief.
    app.add_url_rule('/api/register', view_func=register, methods=['POST'])
    app.add_url_rule('/api/login', view_func=login, methods=['POST'])
    app.add_url_rule('/api/logout', view_func=logout, methods=['POST'])
    app.add_url_rule('/api/profile', view_func=get_profile, methods=['GET'])
    app.add_url_rule('/api/profile', view_func=update_profile, methods=['PUT'])
    app.add_url_rule('/api/change-password', view_func=change_password, methods=['PUT'])
    app.add_url_rule('/api/upload-profile-image', view_func=upload_profile_image, methods=['POST'])
    app.add_url_rule('/api/check', view_func=auth_check, methods=['GET'])
    app.add_url_rule('/api/pickup-requests', view_func=create_pickup_request, methods=['POST'])
    app.add_url_rule('/api/pickup-requests', view_func=list_pickup_requests, methods=['GET'])
    app.add_url_rule('/api/pickup-requests/<int:pickup_id>', view_func=update_pickup_request, methods=['PUT'])
    app.add_url_rule('/api/pickup-requests/<int:pickup_id>/confirm-receipt', view_func=confirm_pickup_receipt, methods=['POST'])
    app.add_url_rule('/api/messages', view_func=get_messages_or_conversations, methods=['GET'])
    app.add_url_rule('/api/messages', view_func=send_message, methods=['POST'])
    app.add_url_rule('/api/qr/generate', view_func=api_generate_qr, methods=['POST'])
    app.add_url_rule('/api/qr/verify', view_func=api_verify_qr, methods=['POST'])
    app.add_url_rule('/api/qr/<int:pickup_request_id>', view_func=api_get_qr, methods=['GET'])

    @app.after_request
    def wrap_json_response(response):
        if not response.is_json:
            return response

        payload = response.get_json(silent=True)
        if payload is None or (isinstance(payload, dict) and 'success' in payload):
            return response

        if response.status_code >= 400:
            msg = 'Request failed'
            code_extra = {}
            if isinstance(payload, dict):
                if 'message' in payload:
                    msg = payload['message']
                if 'code' in payload:
                    code_extra['code'] = payload['code']
            elif isinstance(payload, str):
                msg = payload
            res, status_val = api_response(success=False, message=msg, status=response.status_code, **code_extra)
            res.status_code = status_val
            return res

        res, status_val = api_response(success=True, message='Success', data=payload, status=response.status_code)
        res.status_code = status_val
        return res

    @jwt.unauthorized_loader
    def missing_token(_err):
        return api_response(success=False, message='Missing or invalid authorization token', status=401)

    @jwt.expired_token_loader
    def expired_token(_jwt_header, _jwt_payload):
        return api_response(success=False, message='Token has expired. Please log in again.', status=401)

    @jwt.invalid_token_loader
    def invalid_token(_err):
        return api_response(success=False, message='Invalid token', status=422)

    @app.errorhandler(404)
    def not_found(_err):
        return api_response(success=False, message='Resource not found', status=404)

    @app.errorhandler(500)
    def internal_error(_err):
        app.logger.exception('Unhandled server error')
        return api_response(success=False, message='Internal server error', status=500)

    @app.route('/api/health')
    def health():
        return api_response(success=True, message='Service healthy', data={'service': 'FoodBridge API'})

    @app.route('/uploads/profile/<path:filename>')
    def uploaded_profile(filename):
        return send_from_directory(app.config['PROFILE_UPLOAD_FOLDER'], filename)

    @app.route('/uploads/certificates/<path:filename>')
    def uploaded_certificate(filename):
        return send_from_directory(app.config['CERTIFICATE_UPLOAD_FOLDER'], filename)

    @app.route('/api/profile-image/<path:filename>')
    def uploaded_profile_alias(filename):
        return send_from_directory(app.config['PROFILE_UPLOAD_FOLDER'], filename)


    with app.app_context():
        import time as _time
        for _attempt in range(5):
            try:
                db.create_all()
                break
            except Exception as _exc:
                _msg = str(_exc)
                if any(k in _msg.lower() for k in ['1684', 'ddl', 'being modified', 'connection', 'timeout', 'refused', 'temporarily unavailable']) and _attempt < 4:
                    app.logger.warning(
                        f'db.create_all() waiting for database (attempt {_attempt + 1}/5): {_msg}. Retrying in 3s...'
                    )
                    _time.sleep(3)
                else:
                    if 'password authentication failed' in _msg.lower():
                        app.logger.critical(
                            'DATABASE AUTHENTICATION FAILED: Check your DATABASE_URL username and password in Render environment variables!'
                        )
                    raise
        ensure_phase2_schema(app)
        ensure_phase3_schema(app)
        ensure_allocation_schema(app)
        ensure_verification_schema(app)
        ensure_automated_verification_schema(app)
        ensure_admin_approval_schema(app)
        ensure_two_way_bridge_schema(app)
        ensure_call_schema(app)
        ensure_conversation_schema(app)
        seed_admin_user(app)

    import socket_events  # noqa: F401

    return app


if __name__ == '__main__':
    socketio.run(create_app(), host='127.0.0.1', port=5000, debug=True, allow_unsafe_werkzeug=True)
