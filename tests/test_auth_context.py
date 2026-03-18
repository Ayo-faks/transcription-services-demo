import json
import unittest
from pathlib import Path

from function_app import _normalize_claims


FIXTURES_DIR = Path(__file__).parent / 'fixtures'


class NormalizeClaimsTests(unittest.TestCase):
    def load_fixture(self, name: str) -> dict:
        return json.loads((FIXTURES_DIR / name).read_text(encoding='utf-8'))

    def test_normalize_aad_claims(self):
        claims = _normalize_claims(self.load_fixture('aad-client-principal.json'))

        self.assertEqual(claims['sub'], 'aad-user-123')
        self.assertEqual(claims['email'], 'clinician@nhs.net')
        self.assertEqual(claims['name'], 'Dr Jane Smith')
        self.assertEqual(claims['issuer'], 'https://login.microsoftonline.com')
        self.assertEqual(claims['identity_provider'], 'aad')

    def test_normalize_google_claims(self):
        claims = _normalize_claims(self.load_fixture('google-client-principal.json'))

        self.assertEqual(claims['sub'], 'google-sub-456')
        self.assertEqual(claims['email'], 'developer@gmail.com')
        self.assertEqual(claims['name'], 'Dev User')
        self.assertEqual(claims['issuer'], 'https://accounts.google.com')
        self.assertEqual(claims['identity_provider'], 'google')


if __name__ == '__main__':
    unittest.main()