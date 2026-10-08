# FoodBridge

Local FoodBridge full-stack app with a React + Vite frontend and a Flask + MySQL backend.

## What is included

- JWT authentication
- Role-based routing for donor, receiver, and admin users
- Database-backed profile loading and updates
- Local profile image uploads
- MySQL-backed user persistence with a seeded admin account
- MySQL-backed donor donation CRUD and receiver pickup workflow
- Local donation image uploads in `backend/uploads/donations/`
- OpenStreetMap + Leaflet pickup selection and receiver/admin maps
- Email verification with resend flow through Flask-Mail
- Rule-based food freshness scoring stored in MySQL
- QR completion certificates generated as local PDFs
- Daily, weekly, and monthly report exports in PDF, CSV, and Excel
- Database-backed notification/settings preferences

## Backend setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
flask db init
flask db migrate
flask db upgrade
python run.py
```

Backend runs at `http://127.0.0.1:5000`

Default admin:

- Email: `admin@foodbridge.com`
- Password: `Admin@123`

## Frontend setup

```bash
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`

## Environment variables

Backend `.env`:

```env
SECRET_KEY=
JWT_SECRET_KEY=
DATABASE_URL=mysql+pymysql://root:password@127.0.0.1/foodbridge
UPLOAD_FOLDER=uploads
JWT_ACCESS_TOKEN_EXPIRES=1d
FRONTEND_URL=http://localhost:5173
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=465
MAIL_USE_TLS=False
MAIL_USE_SSL=True
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_DEFAULT_SENDER=noreply@foodbridge.com
```

## Notes

- The backend auto-creates the `foodbridge` database if the MySQL server is reachable.
- Uploaded profile images are stored in `backend/uploads/profile/`.
- Donation images are stored in `backend/uploads/donations/`.
- Certificate PDFs are stored in `backend/uploads/certificates/`.
- Application logs are stored in `backend/logs/foodbridge.log`.
- The live schema is created by SQLAlchemy on startup, with local upgrade helpers in `backend/app.py`.
- A readable schema reference is available at `database/schema.sql`.
- The frontend talks to the backend through `src/lib/api.ts`.
# FoodBridge
