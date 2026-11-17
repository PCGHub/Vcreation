"""No paid calls: real local FFmpeg flow plus mocked provider and transaction boundaries."""
import io
import json
import os
import subprocess
import tempfile
import time
import unittest
from unittest.mock import MagicMock
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image
from app.main import app
from app.services import studio, studio_store as store


class StudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env = patch.dict(os.environ, {"VCREATION_DATABASE": str(self.root / "studio.db"), "VCREATION_ENABLE_PAID_GENERATION": "false"})
        self.env.start()
        self.patches = [patch.object(store, "ROOT", self.root), patch.object(studio, "MEDIA", self.root / "static/studio"),
                        patch("requests.post", side_effect=AssertionError("Unexpected external generation call"))]
        for item in self.patches: item.start()
        self.client = TestClient(app)
        self.client.__enter__()
        self.project = self.post("/projects", {"title": "Interview", "budget_usd": 1})
        self.actor = self.post(f"/projects/{self.project['id']}/characters", {"name": "Mara", "wardrobe": "Navy jacket"})
        self.shot = self.add_shot()

    def tearDown(self):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            with store.connect() as db:
                if not db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running')").fetchone(): break
            time.sleep(.1)
        self.client.__exit__(None, None, None)
        for item in reversed(self.patches): item.stop()
        self.env.stop()
        self.temp.cleanup()

    def post(self, path, body, code=201):
        response = self.client.post("/api/studio" + path, json=body)
        self.assertEqual(response.status_code, code, response.text)
        return response.json()

    def add_shot(self):
        result = self.post(f"/projects/{self.project['id']}/shots", {"title": "A question", "prompt": "Close-up, quiet interview room", "dialogue": "Mara: How did you know?", "duration": 2, "character_ids": [self.actor['id']]})
        return result['shots'][-1]

    def approve(self, shot=None):
        response = self.client.put(f"/api/studio/shots/{(shot or self.shot)['id']}/approval", json={"approved": True})
        self.assertEqual(response.status_code, 200, response.text)

    def wait(self, job):
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            response = self.client.get(f"/api/studio/jobs/{job['id']}")
            current = response.json()
            if current['status'] in studio.TERMINAL:
                self.assertEqual(current['status'], 'succeeded', current)
                return current
            time.sleep(.1)
        self.fail("Job did not finish")

    def test_real_preview_review_export_and_persistence(self):
        shots = [self.shot, self.add_shot()]
        for index, shot in enumerate(shots):
            self.approve(shot)
            quote = self.post(f"/shots/{shot['id']}/quote", {"provider": "preview"}, 200)
            job = self.post(f"/shots/{shot['id']}/takes", {"quote_id": quote['id'], "request_id": f"preview-{index}"}, 202)
            take = self.wait(job)
            self.assertEqual(take['actual_usd'], 0)
            selected = self.client.put(f"/api/studio/shots/{shot['id']}/selection", json={"take_id": take['id']})
            self.assertEqual(selected.status_code, 200, selected.text)
        export = self.post(f"/projects/{self.project['id']}/exports", {"request_id": "export-film"}, 202)
        done = self.wait(export)
        video = self.root / done['output_url'].lstrip('/')
        meta = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video)], text=True))
        self.assertAlmostEqual(float(meta['format']['duration']), 4, delta=.3)
        self.assertEqual(meta['streams'][0]['width'], 1280)
        self.assertEqual(meta['streams'][0]['height'], 720)
        srt = (studio.MEDIA / f"{done['id']}_dialogue.srt").read_text()
        self.assertIn('00:00:02,', srt)
        self.assertIn('Mara: How did you know?', srt)
        store.init_database()  # Persisted records survive reconnecting to SQLite.
        detail = self.client.get(f"/api/studio/projects/{self.project['id']}").json()
        self.assertEqual(len(detail['jobs']), 3)
        self.assertEqual(detail['costs']['actual_usd'], 0)
        ledger = self.client.get(f"/api/studio/projects/{self.project['id']}/costs.csv")
        self.assertEqual(ledger.status_code, 200)
        self.assertIn('actual_usd', ledger.text)

    def test_history_combines_studio_and_editor_without_duplicate_children(self):
        self.approve()
        quote = self.post(f"/shots/{self.shot['id']}/quote", {"provider": "preview"}, 200)
        take = self.wait(self.post(f"/shots/{self.shot['id']}/takes", {"quote_id": quote['id'], "request_id": "history-test"}, 202))
        directory = self.root / "static/edit_jobs"
        directory.mkdir(parents=True)
        (directory / "parent.json").write_text(json.dumps({"id": "parent", "status": "completed", "outputs": [{"job_id": "child", "output_url": "/static/edit/final.mp4"}]}))
        (directory / "child.json").write_text(json.dumps({"id": "child", "status": "completed"}))
        (directory / "broken.json").write_text("{")
        history = self.client.get("/api/studio/history")
        self.assertEqual(history.status_code, 200, history.text)
        rows = {row["id"]: row for row in history.json()}
        self.assertEqual(set(rows), {take["id"], "parent"})
        self.assertEqual(rows[take["id"]]["project_title"], "Interview")
        self.assertEqual(rows["parent"]["output_urls"], ["/static/edit/final.mp4"])

    def test_requires_approval_and_rejects_unconfigured_paid_generation(self):
        self.post(f"/shots/{self.shot['id']}/quote", {"provider": "preview"}, 409)
        self.approve()
        self.post(f"/shots/{self.shot['id']}/quote", {"provider": "replicate"}, 409)
        with store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 0)

    def test_concurrent_duplicate_submission_creates_one_job(self):
        self.approve()
        quote = self.post(f"/shots/{self.shot['id']}/quote", {"provider": "preview"}, 200)
        with patch.object(studio.POOL, 'submit') as submit:
            with ThreadPoolExecutor(max_workers=5) as pool:
                results = list(pool.map(lambda _: studio.create_take(self.shot['id'], quote['id'], 'duplicate-request'), range(5)))
            self.assertEqual(len({j['id'] for j in results}), 1)
            self.assertEqual(submit.call_count, 1)
            store.update_job(results[0]['id'], status='failed')
        self.post(f"/shots/{self.shot['id']}/takes", {"quote_id": 'different', "request_id": 'duplicate-request'}, 409)

    def test_edited_shot_invalidates_quote_and_approval(self):
        self.approve()
        quote = self.post(f"/shots/{self.shot['id']}/quote", {"provider": "preview"}, 200)
        changed = {"title": "New angle", "prompt": "Reverse angle", "duration": 2, "character_ids": [self.actor['id']]}
        self.assertEqual(self.client.put(f"/api/studio/shots/{self.shot['id']}", json=changed).status_code, 200)
        self.post(f"/shots/{self.shot['id']}/takes", {"quote_id": quote['id'], "request_id": 'changed-shot'}, 409)

    def test_budget_reservation_and_actual_cost_reconciliation(self):
        self.approve()
        settings = {"VCREATION_ENABLE_PAID_GENERATION": "true", "REPLICATE_API_TOKEN": "test-only",
                    "VCREATION_REPLICATE_VERSION": 'a'*64, "VCREATION_VIDEO_USD_PER_SECOND": '0.4'}
        with patch.dict(os.environ, settings), patch.object(studio.POOL, 'submit'):
            first_quote = self.post(f"/shots/{self.shot['id']}/quote", {"provider": "replicate"}, 200)
            first = self.post(f"/shots/{self.shot['id']}/takes", {"quote_id": first_quote['id'], "request_id": 'paid-first'}, 202)
            self.assertIsNone(first['actual_usd'])
            second_quote = self.post(f"/shots/{self.shot['id']}/quote", {"provider": "replicate"}, 200)
            self.post(f"/shots/{self.shot['id']}/takes", {"quote_id": second_quote['id'], "request_id": 'paid-second'}, 409)
            store.update_job(first['id'], status='failed')
            response = self.client.put(f"/api/studio/jobs/{first['id']}/billing", json={"actual_usd": .95, "billing_reference": "Provider invoice line 123"})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['actual_usd'], .95)
            self.assertEqual(response.json()['reserved_usd'], .95)

    def test_cross_project_reference_and_path_traversal_rejected(self):
        other = self.post('/projects', {"title": "Other"})
        self.post(f"/projects/{other['id']}/shots", {"title": "Invalid", "prompt": "Test", "character_ids": [self.actor['id']]}, 409)
        self.post(f"/projects/{other['id']}/characters", {"name": "Invalid", "image_path": "/static/studio/references/../../outside.jpg"}, 409)
        response = self.client.post('/api/video/split', json={"ref": "/static/../../etc/passwd"})
        self.assertEqual(response.status_code, 400)

    def test_reference_image_is_verified_and_normalized(self):
        data = io.BytesIO()
        Image.new('RGB', (100, 100), 'blue').save(data, 'PNG')
        response = self.client.post('/api/studio/references', files={"file": ('actor.png', data.getvalue(), 'image/png')})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertTrue(studio.local_image(response.json()['path']).exists())
        invalid = self.client.post('/api/studio/references', files={"file": ('actor.png', b'not an image', 'image/png')})
        self.assertEqual(invalid.status_code, 409)

    def test_blank_database_setting_uses_project_storage(self):
        with patch.dict(os.environ, {"VCREATION_DATABASE": ""}):
            self.assertEqual(store.database_path(), self.root / 'storage/studio.sqlite3')
            store.init_database()

    def test_restart_keeps_uncertain_charge_and_never_resubmits(self):
        self.approve()
        quote = self.post(f"/shots/{self.shot['id']}/quote", {"provider": "preview"}, 200)
        with patch.object(studio.POOL, 'submit'):
            job = studio.create_take(self.shot['id'], quote['id'], 'restart-job')
        studio.initialize()
        self.assertEqual(studio.get_job(job['id'])['status'], 'interrupted')

    def test_routes_are_unique_and_old_generation_is_explicitly_retired(self):
        signatures = [(tuple(sorted(route.methods)), route.path) for route in app.routes if hasattr(route, 'methods')]
        self.assertEqual(len(signatures), len(set(signatures)))
        self.assertEqual(self.client.post('/api/video/generate', json={"prompt": "Test"}).status_code, 410)
        self.assertEqual(self.client.post('/api/generate/image', json={"prompt": "Test"}).status_code, 410)

    def test_paid_adapter_contract_with_mocked_http_and_real_media_validation(self):
        self.approve()
        settings = {"VCREATION_ENABLE_PAID_GENERATION": "true", "REPLICATE_API_TOKEN": "never-persist-this-token",
                    "VCREATION_REPLICATE_VERSION": 'b'*64, "VCREATION_VIDEO_USD_PER_SECOND": '0.1'}
        with patch.dict(os.environ, settings), patch.object(studio.POOL, 'submit'):
            quote = self.post(f"/shots/{self.shot['id']}/quote", {"provider": "replicate"}, 200)
            job = self.post(f"/shots/{self.shot['id']}/takes", {"quote_id": quote['id'], "request_id": 'mock-provider'}, 202)
            source_url = studio.render_preview(job['snapshot'], 'provider-fixture')
            source = studio.media_path(source_url).read_bytes()
            response = MagicMock(status_code=201)
            response.json.return_value = {"id": "prediction123", "status": "succeeded", "output": "https://replicate.delivery/asset.mp4"}
            download = MagicMock(status_code=200)
            download.__enter__.return_value = download
            download.iter_content.return_value = [source]
            with patch('requests.post', return_value=response) as post, patch('requests.get', return_value=download):
                studio.run_take(job['id'])
                self.assertEqual(post.call_count, 1)
                submitted = post.call_args.kwargs['json']
                self.assertEqual(submitted['version'], 'b'*64)
                self.assertIn('Navy jacket', submitted['input']['prompt'])
            take = studio.get_job(job['id'])
            self.assertEqual(take['status'], 'succeeded', take)
            self.assertEqual(take['provider_id'], 'prediction123')
            self.assertIsNone(take['actual_usd'])
            self.assertNotIn('never-persist-this-token', json.dumps(take))

    def test_reorder_preserves_take_selection_but_rejects_other_projects(self):
        second = self.add_shot()
        response = self.client.put(f"/api/studio/projects/{self.project['id']}/order", json={"shot_ids": [second['id'], self.shot['id']]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['shots'][0]['id'], second['id'])
        invalid = self.client.put(f"/api/studio/projects/{self.project['id']}/order", json={"shot_ids": [second['id'], second['id']]})
        self.assertEqual(invalid.status_code, 409)

    def test_multi_edit_keeps_all_clips_and_requested_output_count(self):
        from app.api.edit import MultiEditRunRequest, _run_multi_job_background
        request = MultiEditRunRequest.model_validate({"clips": [{"id": 1, "ref": "/static/one.mp4"}, {"id": 2, "ref": "/static/two.mp4"}], "num_outputs": 2})
        self.assertEqual(len(request.clips), 2)
        self.assertIsNone(request.clip_ref)
        with patch('app.api.edit.create_job', return_value={"id": "child"}) as create, patch('app.api.edit.run_edit_job', return_value={"id": "child", "output_url": "/static/result.mp4"}), patch('app.api.edit.update_job'):
            _run_multi_job_background(None, 'parent', request)
            self.assertEqual(create.call_count, 2)
            self.assertEqual(len(create.call_args.args[3]), 2)

    def test_legacy_job_polling_never_observes_partial_json(self):
        from app.services.job_files import write_json_atomic
        path = self.root / 'legacy-job.json'
        write_json_atomic(path, {"progress": 0, "payload": "x" * 100000})
        def writer():
            for index in range(40):
                write_json_atomic(path, {"progress": index, "payload": "x" * 100000})
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(writer)
            while not future.done():
                self.assertIn('progress', json.loads(path.read_text()))
            future.result()


if __name__ == '__main__':
    unittest.main()
