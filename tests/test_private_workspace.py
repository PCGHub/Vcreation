import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
from app.main import app
from app import security
from app.services import studio, studio_store as store

class PrivateWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.env = patch.dict(os.environ, {"VCREATION_REQUIRE_AUTH": "true", "VCREATION_DATABASE": str(self.root / 'db.sqlite3'), "SUPABASE_URL": "https://qa.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "public-test-key", "VCREATION_OWNER_EMAILS": "owner@example.com", "VCREATION_ALLOWED_ORIGINS": "https://vcreation.vercel.app"})
        self.env.start(); self.patches = [patch.object(store, 'ROOT', self.root), patch.object(studio, 'MEDIA', self.root / 'static/studio')]
        for p in self.patches: p.start()
        security._cache.clear(); self.client = TestClient(app); self.client.__enter__()
    def tearDown(self):
        self.client.__exit__(None, None, None)
        for p in reversed(self.patches): p.stop()
        self.env.stop(); self.temp.cleanup(); security._cache.clear()
    def authority(self, email='owner@example.com', confirmed=True, status=200):
        response = Mock(); response.status_code=status
        response.json.return_value={'id':'owner-id','email':email,'email_confirmed_at':'2026-01-01' if confirmed else None,'is_anonymous':False}
        return patch('app.security.requests.get',return_value=response)
    def test_anonymous_cannot_read_projects_exports_docs_or_media(self):
        self.assertEqual(self.client.get('/').status_code,200)
        for path in ['/api/studio/projects','/api/studio/history','/api/edit/status/test','/static/studio/private.mp4','/docs','/openapi.json']:
            self.assertEqual(self.client.get(path).status_code,401,path)
    def test_forged_token_is_rejected_by_authority(self):
        with self.authority(status=401):
            self.assertEqual(self.client.get('/api/studio/projects',headers={'Authorization':'Bearer forged-token'}).status_code,401)
    def test_other_verified_account_cannot_see_existing_workspace(self):
        with self.authority(email='other@example.com'):
            self.assertEqual(self.client.get('/api/studio/projects',headers={'Authorization':'Bearer other-token'}).status_code,403)
    def test_unconfirmed_owner_is_rejected(self):
        with self.authority(confirmed=False):
            self.assertEqual(self.client.get('/api/studio/projects',headers={'Authorization':'Bearer pending-token'}).status_code,401)
    def test_verified_owner_can_read_and_responses_are_not_publicly_cacheable(self):
        with self.authority():
            response=self.client.get('/api/studio/projects',headers={'Authorization':'Bearer owner-token'})
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.headers['cache-control'],'private, no-store')
            self.assertIn('Authorization',response.headers['vary'])
    def test_cookie_write_requires_allowed_origin(self):
        self.client.cookies.set(security.COOKIE_NAME,'owner-token')
        with self.authority():
            body={'title':'Private film','budget_usd':0}
            self.assertEqual(self.client.post('/api/studio/projects',json=body,headers={'Origin':'https://attacker.example'}).status_code,403)
            self.assertEqual(self.client.post('/api/studio/projects',json=body,headers={'Origin':'https://vcreation.vercel.app'}).status_code,201)
    def test_authority_outage_and_missing_owner_config_fail_closed(self):
        with self.authority(status=503):
            self.assertEqual(self.client.get('/api/studio/projects',headers={'Authorization':'Bearer valid-looking-token'}).status_code,503)
        with patch.dict(os.environ,{'VCREATION_OWNER_EMAILS':''}):
            self.assertEqual(self.client.get('/api/studio/projects',headers={'Authorization':'Bearer valid-looking-token'}).status_code,503)
