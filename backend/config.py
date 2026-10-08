import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()


def _parse_duration(value: str | None, default: timedelta) -> timedelta:
    if not value:
        return default
    raw = value.strip().lower()
    if raw.endswith('d'):
        return timedelta(days=int(raw[:-1] or 0))
    if raw.endswith('h'):
        return timedelta(hours=int(raw[:-1] or 0))
    return default


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'foodbridge-secret-key-change-in-production')

    _raw_db_url = (os.environ.get('DATABASE_URL') or '').strip().strip("'").strip('"')
    if not _raw_db_url:
        database_url = 'mysql+pymysql://root:password@127.0.0.1/foodbridge'
    elif _raw_db_url.startswith('postgres://'):
        database_url = _raw_db_url.replace('postgres://', 'postgresql://', 1)
    else:
        database_url = _raw_db_url

    # Normalize localhost to 127.0.0.1 to prevent Eventlet / Windows DNS resolution failures
    if '@localhost/' in database_url:
        database_url = database_url.replace('@localhost/', '@127.0.0.1/')
    elif '@localhost:' in database_url:
        database_url = database_url.replace('@localhost:', '@127.0.0.1:')

    SQLALCHEMY_DATABASE_URI = database_url
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,
        'pool_recycle': 300,
    }

    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', 'foodbridge-jwt-secret-change-in-production')
    JWT_ACCESS_TOKEN_EXPIRES = _parse_duration(os.environ.get('JWT_ACCESS_TOKEN_EXPIRES'), timedelta(days=1))
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)

    # The initial administrator is created on startup.
    ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@foodbridge.org').strip().lower()
    ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'Admin@123')
    ADMIN_NAME = os.environ.get('ADMIN_NAME', 'FoodBridge Admin').strip() or 'FoodBridge Admin'

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
    PROFILE_UPLOAD_FOLDER = os.path.join(UPLOAD_FOLDER, 'profile')
    DONATION_UPLOAD_FOLDER = os.path.join(UPLOAD_FOLDER, 'donations')
    CERTIFICATE_UPLOAD_FOLDER = os.path.join(UPLOAD_FOLDER, 'certificates')
    VERIFICATION_UPLOAD_FOLDER = os.path.join(UPLOAD_FOLDER, 'verification')
    LOG_FOLDER = os.path.join(BASE_DIR, 'logs')
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024

    MAIL_SERVER = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
    MAIL_PORT = int(os.environ.get('MAIL_PORT', 465))
    MAIL_USE_TLS = os.environ.get('MAIL_USE_TLS', 'False') == 'True'
    MAIL_USE_SSL = os.environ.get('MAIL_USE_SSL', 'True') == 'True'
    MAIL_USERNAME = os.environ.get('MAIL_USERNAME')
    MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD')
    MAIL_DEFAULT_SENDER = os.environ.get('MAIL_DEFAULT_SENDER', 'FoodBridge <onboarding@resend.dev>')
    RESEND_API_KEY = os.environ.get('RESEND_API_KEY')

    FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:5190')
    NOMINATIM_USER_AGENT = os.environ.get(
        'NOMINATIM_USER_AGENT',
        'FoodBridge/1.0 (+https://foodbridge.local; contact=support@foodbridge.local)',
    )
    OSRM_BASE_URL = os.environ.get('OSRM_BASE_URL', 'https://router.project-osrm.org')
    OSRM_TIMEOUT_SECONDS = float(os.environ.get('OSRM_TIMEOUT_SECONDS', '10'))

    # FSSAI Verification Configuration
    FSSAI_PROVIDER = os.environ.get('FSSAI_PROVIDER', 'mock')


