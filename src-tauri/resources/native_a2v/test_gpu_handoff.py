import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from gpu_handoff import consume_single_job_handoff

class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.request=self.root/'request.json'
        self.environment=self.root/'environment.json'
        self.context={'operationId':'op','projectId':'p','target':{'kind':'cut','id':'c'},'approval':{'requestId':'op','projectId':'p','target':{'kind':'cut','id':'c'},'producerSafeBoundaryConfirmed':True}}
        self.request.write_text(json.dumps({'gpuHandoffContext':self.context}),encoding='utf8')
        self.manifest={'gpu_execution_authorized':False,'single_job_gpu_handoff':{'schema':'native-gpu-single-job-v1','context':self.context,'requestSha256':hashlib.sha256(self.request.read_bytes()).hexdigest(),'nonce':'unique','approvedAtUnix':100,'expiresAtUnix':160}}
    def tearDown(self):self.temp.cleanup()
    def test_explicit_scoped_grant_does_not_change_global_permission(self):
        self.assertTrue(consume_single_job_handoff(self.manifest,self.request,self.environment,110))
        self.assertFalse(self.manifest['gpu_execution_authorized'])
    def test_worker_replay_is_rejected(self):
        consume_single_job_handoff(self.manifest,self.request,self.environment,110)
        with self.assertRaises(FileExistsError):consume_single_job_handoff(self.manifest,self.request,self.environment,110)
    def test_changed_request_is_rejected(self):
        self.request.write_text('{}')
        with self.assertRaisesRegex(ValueError,'request_mismatch'):consume_single_job_handoff(self.manifest,self.request,self.environment,110)
    def test_expired_and_future_grants_are_rejected(self):
        for now in [99,161]:
            with self.assertRaisesRegex(ValueError,'expired'):consume_single_job_handoff(self.manifest,self.request,self.environment,now)
    def test_identity_mismatch_and_missing_confirmation_are_rejected(self):
        for key in ['requestId','projectId','target','producerSafeBoundaryConfirmed']:
            saved=self.context['approval'][key]
            self.context['approval'][key]=None
            self.request.write_text(json.dumps({'gpuHandoffContext':self.context}),encoding='utf8')
            self.manifest['single_job_gpu_handoff']['requestSha256']=hashlib.sha256(self.request.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError,'identity_mismatch'):consume_single_job_handoff(self.manifest,self.request,self.environment,110)
            self.context['approval'][key]=saved
    def test_no_grant_keeps_existing_gate(self):
        self.assertFalse(consume_single_job_handoff({'gpu_execution_authorized':False},self.request,self.environment,110))
    def test_context_mismatch_rejected(self):
        self.manifest['single_job_gpu_handoff']['context']={'other':True}
        with self.assertRaisesRegex(ValueError,'context_mismatch'):consume_single_job_handoff(self.manifest,self.request,self.environment,110)

if __name__=='__main__':unittest.main()
