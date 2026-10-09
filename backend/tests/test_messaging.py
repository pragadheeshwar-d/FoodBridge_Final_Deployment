from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app
from config import Config
from extensions import db
from models import User, Donation, PickupRequest, Conversation, Message
from flask_jwt_extended import create_access_token


class TestConfig(Config):
    TESTING = True
    WTF_CSRF_ENABLED = False
    SQLALCHEMY_ENGINE_OPTIONS = {'connect_args': {'check_same_thread': False}}


class MessagingFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db_file = tempfile.NamedTemporaryFile(delete=False, suffix='.db')
        cls.db_file.close()
        cls._old_database_uri = TestConfig.SQLALCHEMY_DATABASE_URI
        TestConfig.SQLALCHEMY_DATABASE_URI = f"sqlite:///{cls.db_file.name}"
        cls.app = create_app(TestConfig)
        cls.client = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        TestConfig.SQLALCHEMY_DATABASE_URI = cls._old_database_uri
        try:
            Path(cls.db_file.name).unlink(missing_ok=True)
        except Exception:
            pass

    def setUp(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
            db.create_all()

            # 1. Create donor user
            self.donor = User(
                name='Grand Chola Donor',
                email='donor@chola.com',
                password='hashed',
                role='donor',
                organization='Grand Chola Kitchen',
                status='approved',
                verified=True,
            )
            # 2. Create receiver user
            self.receiver = User(
                name='Hope Shelter NGO',
                email='receiver@hope.com',
                password='hashed',
                role='receiver',
                organization='Hope Shelter Foundation',
                status='approved',
                verified=True,
            )
            # 3. Create another donor (to test donor-to-donor block)
            self.other_donor = User(
                name='Other Donor',
                email='other_donor@test.com',
                password='hashed',
                role='donor',
                organization='Other Kitchen',
                status='approved',
                verified=True,
            )
            # 4. Create admin user
            self.admin = User(
                name='Admin User',
                email='admin@foodbridge.org',
                password='hashed',
                role='admin',
                status='approved',
                verified=True,
            )
            db.session.add_all([self.donor, self.receiver, self.other_donor, self.admin])
            db.session.commit()

            # Create tokens
            self.donor_token = create_access_token(identity=str(self.donor.id))
            self.receiver_token = create_access_token(identity=str(self.receiver.id))
            self.other_donor_token = create_access_token(identity=str(self.other_donor.id))
            self.admin_token = create_access_token(identity=str(self.admin.id))

    def _auth_header(self, token: str) -> dict:
        return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

    def _get_data(self, resp):
        body = resp.get_json()
        if isinstance(body, dict) and 'data' in body:
            return body['data']
        return body

    def test_full_donor_receiver_messaging_flow(self):
        with self.app.app_context():
            # Step 1: Donor creates donation
            donation = Donation(
                donor_id=self.donor.id,
                food_name='Vegetable Biryani',
                food_type='Cooked Meal',
                category='main',
                veg_type='veg',
                quantity='50 meals',
                quantity_number=50.0,
                remaining_quantity=50.0,
                unit='meals',
                pickup_address='Guindy, Chennai',
                expiry_time=datetime.utcnow() + timedelta(hours=4),
                status='Available',
            )
            db.session.add(donation)
            db.session.commit()
            donation_id = donation.id

        # Step 2: Receiver requests donation with initial message
        resp = self.client.post(
            '/api/pickups',
            headers=self._auth_header(self.receiver_token),
            json={
                'donation_id': donation_id,
                'requested_quantity': 25.0,
                'request_message': 'We would like to collect 25 meals for our shelter.',
            },
        )
        self.assertEqual(resp.status_code, 201)

        # Step 3: Verify conversation is created in database
        with self.app.app_context():
            conv = Conversation.query.filter_by(
                donor_id=self.donor.id,
                receiver_id=self.receiver.id,
                donation_id=donation_id,
            ).first()
            self.assertIsNotNone(conv)
            conv_id = conv.id

            # Verify initial message exists
            initial_msg = Message.query.filter_by(conversation_id=conv_id).first()
            self.assertIsNotNone(initial_msg)
            self.assertEqual(initial_msg.message, 'We would like to collect 25 meals for our shelter.')
            self.assertEqual(initial_msg.sender_id, self.receiver.id)
            self.assertEqual(initial_msg.receiver_id, self.donor.id)
            self.assertFalse(initial_msg.is_read)

        # Step 4: Donor gets conversations list -> see conversation with unread_count=1
        resp = self.client.get('/api/chat/conversations', headers=self._auth_header(self.donor_token))
        self.assertEqual(resp.status_code, 200)
        convs = self._get_data(resp)
        self.assertEqual(len(convs), 1)
        self.assertEqual(convs[0]['id'], conv_id)
        self.assertEqual(convs[0]['partner']['name'], 'Hope Shelter Foundation')
        self.assertEqual(convs[0]['unread_count'], 1)
        self.assertEqual(convs[0]['last_message']['message'], 'We would like to collect 25 meals for our shelter.')

        # Step 5: Donor opens conversation messages -> marks unread as read
        resp = self.client.get(f'/api/chat/conversations/{conv_id}/messages', headers=self._auth_header(self.donor_token))
        self.assertEqual(resp.status_code, 200)
        messages = self._get_data(resp)
        self.assertEqual(len(messages), 1)

        # Re-check unread count for donor -> now 0
        resp = self.client.get('/api/chat/conversations', headers=self._auth_header(self.donor_token))
        self.assertEqual(self._get_data(resp)[0]['unread_count'], 0)

        # Step 6: Donor replies to receiver
        reply_resp = self.client.post(
            '/api/chat/messages',
            headers=self._auth_header(self.donor_token),
            json={
                'conversation_id': conv_id,
                'message': 'Approved! Food will be ready at 1:30 PM.',
            },
        )
        self.assertEqual(reply_resp.status_code, 201)
        reply_data = self._get_data(reply_resp)
        self.assertEqual(reply_data['sender_id'], self.donor.id)
        self.assertEqual(reply_data['receiver_id'], self.receiver.id)

        # Step 7: Receiver gets conversation messages -> shows both messages in chronological order
        resp = self.client.get(f'/api/chat/conversations/{conv_id}/messages', headers=self._auth_header(self.receiver_token))
        self.assertEqual(resp.status_code, 200)
        all_msgs = self._get_data(resp)
        self.assertEqual(len(all_msgs), 2)
        self.assertEqual(all_msgs[0]['message'], 'We would like to collect 25 meals for our shelter.')
        self.assertEqual(all_msgs[1]['message'], 'Approved! Food will be ready at 1:30 PM.')

    def test_security_unauthorized_user_cannot_access_conversation(self):
        with self.app.app_context():
            conv = Conversation(
                donor_id=self.donor.id,
                receiver_id=self.receiver.id,
            )
            db.session.add(conv)
            db.session.commit()
            conv_id = conv.id

        # Other donor attempts to access conversation messages -> 403 Forbidden
        resp = self.client.get(
            f'/api/chat/conversations/{conv_id}/messages',
            headers=self._auth_header(self.other_donor_token),
        )
        self.assertEqual(resp.status_code, 403)

        # Admin attempts to access chat -> 403 Forbidden (Messaging is Donor ↔ Receiver only)
        resp = self.client.get(
            f'/api/chat/conversations/{conv_id}/messages',
            headers=self._auth_header(self.admin_token),
        )
        self.assertEqual(resp.status_code, 403)

    def test_donor_to_donor_messaging_is_blocked(self):
        resp = self.client.post(
            '/api/chat/messages',
            headers=self._auth_header(self.donor_token),
            json={
                'receiver_id': self.other_donor.id,
                'message': 'Hello fellow donor',
            },
        )
        self.assertEqual(resp.status_code, 403)

    def test_empty_message_is_rejected(self):
        with self.app.app_context():
            conv = Conversation(
                donor_id=self.donor.id,
                receiver_id=self.receiver.id,
            )
            db.session.add(conv)
            db.session.commit()
            conv_id = conv.id

        resp = self.client.post(
            '/api/chat/messages',
            headers=self._auth_header(self.donor_token),
            json={
                'conversation_id': conv_id,
                'message': '    ',
            },
        )
        self.assertEqual(resp.status_code, 400)

    def test_single_chat_per_partner_deduplication(self):
        """
        Verify that multiple pickup requests between the same donor and receiver
        maintain EXACTLY ONE chat thread ("one has only one chat don't many chat").
        """
        with self.app.app_context():
            # Donation 1
            d1 = Donation(
                donor_id=self.donor.id,
                food_name='Lunch Meal Pack 1',
                food_type='Cooked Meal',
                quantity='20 meals',
                quantity_number=20.0,
                remaining_quantity=20.0,
                pickup_address='Guindy, Chennai',
                expiry_time=datetime.utcnow() + timedelta(hours=4),
                status='Available',
            )
            # Donation 2
            d2 = Donation(
                donor_id=self.donor.id,
                food_name='Dinner Meal Pack 2',
                food_type='Cooked Meal',
                quantity='30 meals',
                quantity_number=30.0,
                remaining_quantity=30.0,
                pickup_address='Guindy, Chennai',
                expiry_time=datetime.utcnow() + timedelta(hours=6),
                status='Available',
            )
            db.session.add_all([d1, d2])
            db.session.commit()
            d1_id = d1.id
            d2_id = d2.id

        # First pickup request on Donation 1
        resp1 = self.client.post(
            '/api/pickups',
            headers=self._auth_header(self.receiver_token),
            json={
                'donation_id': d1_id,
                'requested_quantity': 10.0,
                'request_message': 'Requesting food from pack 1',
            },
        )
        self.assertEqual(resp1.status_code, 201)

        # Second pickup request on Donation 2 from the same donor
        resp2 = self.client.post(
            '/api/pickups',
            headers=self._auth_header(self.receiver_token),
            json={
                'donation_id': d2_id,
                'requested_quantity': 15.0,
                'request_message': 'Requesting food from pack 2',
            },
        )
        self.assertEqual(resp2.status_code, 201)

        # 1. Database check: exactly ONE conversation exists between donor and receiver
        with self.app.app_context():
            convs_in_db = Conversation.query.filter_by(
                donor_id=self.donor.id,
                receiver_id=self.receiver.id,
            ).all()
            self.assertEqual(len(convs_in_db), 1, "There must be strictly ONE conversation between donor and receiver!")
            conv_id = convs_in_db[0].id
            # Context updated to latest donation
            self.assertEqual(convs_in_db[0].donation_id, d2_id)

        # 2. Receiver conversations API check: returns strictly 1 conversation
        recv_convs_resp = self.client.get('/api/chat/conversations', headers=self._auth_header(self.receiver_token))
        self.assertEqual(recv_convs_resp.status_code, 200)
        recv_convs = self._get_data(recv_convs_resp)
        self.assertEqual(len(recv_convs), 1, "Receiver sidebar must have only 1 chat with the donor!")
        self.assertEqual(recv_convs[0]['partner']['name'], 'Grand Chola Kitchen')

        # 3. Donor conversations API check: returns strictly 1 conversation
        donor_convs_resp = self.client.get('/api/chat/conversations', headers=self._auth_header(self.donor_token))
        self.assertEqual(donor_convs_resp.status_code, 200)
        donor_convs = self._get_data(donor_convs_resp)
        self.assertEqual(len(donor_convs), 1, "Donor sidebar must have only 1 chat with the receiver!")
        self.assertEqual(donor_convs[0]['partner']['name'], 'Hope Shelter Foundation')

        # 4. Message history check: both messages are consolidated in this single thread
        msgs_resp = self.client.get(f'/api/chat/conversations/{conv_id}/messages', headers=self._auth_header(self.receiver_token))
        self.assertEqual(msgs_resp.status_code, 200)
        msgs = self._get_data(msgs_resp)
        self.assertEqual(len(msgs), 2)
        self.assertEqual(msgs[0]['message'], 'Requesting food from pack 1')
        self.assertEqual(msgs[1]['message'], 'Requesting food from pack 2')

        # 5. Lookup API check: looking up either donation returns the same conversation
        lookup_resp = self.client.post(
            '/api/chat/conversations/lookup',
            headers=self._auth_header(self.receiver_token),
            json={'partner_id': self.donor.id, 'donation_id': d1_id},
        )
        self.assertEqual(lookup_resp.status_code, 200)
        lookup_data = self._get_data(lookup_resp)
        self.assertEqual(lookup_data['conversation']['id'], conv_id)

    def test_direct_donor_receiver_chat_initiation(self):
        """Test that a receiver can initiate chat with a donor directly (e.g. from partner profile modal)."""
        # Lookup/create conversation directly with partner_id
        lookup_resp = self.client.post(
            '/api/chat/conversations/lookup',
            headers=self._auth_header(self.receiver_token),
            json={'partner_id': self.donor.id},
        )
        self.assertEqual(lookup_resp.status_code, 200)
        lookup_data = self._get_data(lookup_resp)
        self.assertTrue(lookup_data['success'])
        conv_id = lookup_data['conversation']['id']

        # Send direct message
        send_resp = self.client.post(
            '/api/chat/messages',
            headers=self._auth_header(self.receiver_token),
            json={
                'conversation_id': conv_id,
                'message': 'Hello, I would like to connect regarding future food donations!',
            },
        )
        self.assertEqual(send_resp.status_code, 201)
        send_data = self._get_data(send_resp)
        self.assertEqual(send_data['message'], 'Hello, I would like to connect regarding future food donations!')
        self.assertEqual(send_data['conversation_id'], conv_id)


if __name__ == '__main__':
    unittest.main()

