from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app
from config import Config
from extensions import db
from models import Donation, User
from services import map_service


class TestConfig(Config):
    TESTING = True
    WTF_CSRF_ENABLED = False
    SQLALCHEMY_ENGINE_OPTIONS = {'connect_args': {'check_same_thread': False}}


class DonationMapServiceTests(unittest.TestCase):
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
        map_service._GEOCODE_CACHE.clear()
        map_service._ROUTE_CACHE.clear()

    def _create_receiver_donations(self, count: int, *, base_lat: float = 13.08, base_lng: float = 80.27):
        with self.app.app_context():
            donor = User(
                name='Test Donor',
                email=f'donor-{count}@example.com',
                password='hashed',
                role='donor',
                organization='Test Kitchen',
                status='approved',
                verified=True,
            )
            db.session.add(donor)
            db.session.flush()

            donations = []
            for index in range(count):
                donation = Donation(
                    donor_id=donor.id,
                    food_name=f'Rice Parcel {index + 1}',
                    food_type='Rice',
                    category='main',
                    veg_type='veg' if index % 2 == 0 else 'nonveg',
                    quantity='20 meals',
                    quantity_number=20,
                    remaining_quantity=20,
                    unit='meals',
                    pickup_address=f'{index + 1} Test Street',
                    latitude=base_lat + index * 0.002,
                    longitude=base_lng + index * 0.002,
                    pickup_time=datetime.utcnow() + timedelta(hours=1),
                    expiry_time=datetime.utcnow() + timedelta(hours=4),
                    status='Available',
                )
                db.session.add(donation)
                donations.append(donation)

            db.session.commit()
            return donations

    def test_geocode_happy_path(self):
        payload = [
            {
                'lat': '13.1234',
                'lon': '80.2345',
                'display_name': '123 Test Street, Chennai',
            }
        ]

        def fake_fetch_json(url, headers=None, timeout=None):
            self.assertIn('nominatim.openstreetmap.org/search', url)
            self.assertIn('User-Agent', headers or {})
            return payload

        with patch('services.map_service._fetch_json', side_effect=fake_fetch_json):
            response = self.client.post('/api/donations/geocode', json={'address': '123 Test Street'})

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body['success'])
        self.assertAlmostEqual(body['data']['latitude'], 13.1234)
        self.assertAlmostEqual(body['data']['longitude'], 80.2345)

    def test_geocode_rejects_blank_address(self):
        response = self.client.post('/api/donations/geocode', json={'address': '   '})
        self.assertEqual(response.status_code, 400)
        body = response.get_json()
        self.assertFalse(body['success'])

    def test_nearby_happy_path_uses_table_for_large_shortlist(self):
        self._create_receiver_donations(11)

        def fake_fetch_json(url, headers=None, timeout=None):
            if '/table/v1/' in url:
                distances = [[0.0]]
                durations = [[0.0]]
                for index in range(11):
                    distances[0].append(1200 + index * 150)
                    durations[0].append(600 + index * 30)
                return {'distances': distances, 'durations': durations}
            raise AssertionError(f'Unexpected URL: {url}')

        with patch('services.map_service._fetch_json', side_effect=fake_fetch_json):
            response = self.client.get('/api/donations/nearby', query_string={'lat': 13.08, 'lng': 80.27, 'radius_km': 5, 'mode': 'driving'})

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        donations = body['data']['donations']
        self.assertEqual(len(donations), 11)
        distances = [item['road_distance_km'] for item in donations]
        self.assertEqual(distances, sorted(distances))
        self.assertLessEqual(distances[0], distances[-1])

    def test_nearby_falls_back_to_haversine_when_osrm_times_out(self):
        self._create_receiver_donations(1, base_lat=13.09, base_lng=80.28)

        with patch('services.map_service._fetch_json', side_effect=TimeoutError('OSRM timeout')):
            response = self.client.get('/api/donations/nearby', query_string={'lat': 13.08, 'lng': 80.27, 'radius_km': 5, 'mode': 'driving'})

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        donations = body['data']['donations']
        self.assertEqual(len(donations), 1)
        self.assertGreater(donations[0]['road_distance_km'], 0)

    def test_nearby_excludes_donation_outside_road_radius(self):
        self._create_receiver_donations(1)

        def fake_fetch_json(url, headers=None, timeout=None):
            if '/route/v1/' in url:
                return {
                    'routes': [
                        {
                            'distance': 2500.0,
                            'duration': 900.0,
                            'geometry': {
                                'type': 'LineString',
                                'coordinates': [[80.27, 13.08], [80.28, 13.09]],
                            },
                        }
                    ]
                }
            raise AssertionError(f'Unexpected URL: {url}')

        with patch('services.map_service._fetch_json', side_effect=fake_fetch_json):
            response = self.client.get('/api/donations/nearby', query_string={'lat': 13.08, 'lng': 80.27, 'radius_km': 2, 'mode': 'driving'})

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body['data']['donations'], [])


if __name__ == '__main__':
    unittest.main()
