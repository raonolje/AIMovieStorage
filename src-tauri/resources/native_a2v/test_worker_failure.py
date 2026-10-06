import unittest,sys,io,json
from unittest.mock import patch,MagicMock
import a2v_worker

class WorkerFailureTests(unittest.TestCase):
    def test_oom_returns_normal_failure_and_releases_only_own_cache(self):
        torch=MagicMock();torch.cuda.is_initialized.return_value=True
        with patch.object(a2v_worker,'main',side_effect=RuntimeError('CUDA out of memory')),patch.dict(sys.modules,{'torch':torch}),patch('sys.stdout',new_callable=io.StringIO) as out:
            code=a2v_worker.entrypoint()
        self.assertEqual(code,1)
        response=json.loads(out.getvalue())
        self.assertEqual(response['code'],'out_of_memory')
        self.assertFalse(response['qualityApproved'])
        self.assertFalse(response['forceTermination'])
        torch.cuda.empty_cache.assert_called_once_with()
    def test_cpu_failure_does_not_initialize_cuda(self):
        torch=MagicMock();torch.cuda.is_initialized.return_value=False
        with patch.object(a2v_worker,'main',side_effect=ValueError('invalid_request')),patch.dict(sys.modules,{'torch':torch}),patch('sys.stdout',new_callable=io.StringIO) as out:
            self.assertEqual(a2v_worker.entrypoint(),1)
        torch.cuda.empty_cache.assert_not_called()
        self.assertFalse(json.loads(out.getvalue())['ownCudaCacheReleaseAttemptSucceeded'])
    def test_cleanup_failure_does_not_hide_original_oom(self):
        torch=MagicMock();torch.cuda.is_initialized.return_value=True;torch.cuda.empty_cache.side_effect=RuntimeError('cache cleanup failed')
        with patch.object(a2v_worker,'main',side_effect=RuntimeError('CUDA out of memory')),patch.dict(sys.modules,{'torch':torch}),patch('sys.stdout',new_callable=io.StringIO) as out:
            self.assertEqual(a2v_worker.entrypoint(),1)
        self.assertEqual(json.loads(out.getvalue())['error'],'CUDA out of memory')
if __name__=='__main__':unittest.main()
