import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from app.api.edit import MultiEditRunRequest, _run_multi_job_background
from app.services.edit_engine import EditPaths, create_job, load_job

class RealEditDeliveryTests(unittest.TestCase):
    def test_three_distinct_versions_include_both_clips(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); static=root/'static'; sources=static/'sources'; sources.mkdir(parents=True)
            paths=EditPaths(static,static/'upload',sources,static/'edit_jobs',static/'videos',static/'tmp')
            for name,color in [('one','red'),('two','blue')]:
                subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',f'color={color}:size=640x360:rate=24:duration=2','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','2','-vf','drawbox=x=10:y=20:w=90:h=90:color=white:t=fill','-c:v','libx264','-threads','2','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',str(sources/f'{name}.mp4')],check=True)
            request=MultiEditRunRequest.model_validate({'clips':[{'id':1,'ref':'/static/sources/one.mp4'},{'id':2,'ref':'/static/sources/two.mp4'}],'num_outputs':3,'mode':'clean'})
            parent=create_job(paths,'QA multi edit',{'type':'multi_edit'},[c.model_dump() for c in request.clips])
            with patch('app.services.edit_engine.requests.get',side_effect=AssertionError('No external media downloads')):
                _run_multi_job_background(paths,parent['id'],request)
            result=load_job(paths,parent['id']);self.assertEqual(result['status'],'succeeded',result.get('error'))
            self.assertEqual(len(result['outputs']),3)
            files=[]
            for output in result['outputs']:
                child=load_job(paths,output['job_id']);self.assertEqual(len(child['clips']),2)
                path=root/output['output_url'].lstrip('/');files.append(path)
                meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(path)]))
                duration=float(meta['format']['duration']);self.assertGreater(duration,3.4);self.assertLess(duration,4.5)
                frame=subprocess.check_output(['ffmpeg','-v','error','-ss','3','-i',str(path),'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-threads','1','-'])
                self.assertGreater(frame[2],frame[0]+50,'Second (blue) clip missing')
            self.assertNotEqual(files[0].read_bytes(),files[2].read_bytes(),'Punch-in must differ from clean cut')
