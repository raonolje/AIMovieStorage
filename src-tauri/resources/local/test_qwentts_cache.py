import pathlib,sys,tempfile,types,unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from engines import qwentts

class QwenCacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)
        self.repo=self.root/'models'/'hub'/'models--Qwen--Qwen3-TTS-12Hz-1.7B-VoiceDesign'
        self.snapshot=self.repo/'snapshots'/('a'*40)
        (self.repo/'refs').mkdir(parents=True);(self.repo/'refs/main').write_text('a'*40)
        for name in ('config.json','generation_config.json','model.safetensors','tokenizer_config.json','merges.txt','vocab.json','preprocessor_config.json','speech_tokenizer/config.json','speech_tokenizer/configuration.json','speech_tokenizer/model.safetensors','speech_tokenizer/preprocessor_config.json'):
            p=self.snapshot/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'x')
    def tearDown(self): self.tmp.cleanup()
    def test_complete_cache_uses_local_snapshot(self):
        self.assertEqual(qwentts._model_source(self.root,'design'),str(self.snapshot.resolve()))
    def test_incomplete_tokenizer_keeps_download_route(self):
        (self.snapshot/'speech_tokenizer/model.safetensors').unlink()
        self.assertEqual(qwentts._model_source(self.root,'design'),qwentts.MODELS['design'])
    def test_empty_weight_keeps_download_route(self):
        (self.snapshot/'model.safetensors').write_bytes(b'')
        self.assertEqual(qwentts._model_source(self.root,'design'),qwentts.MODELS['design'])
    def test_invalid_ref_cannot_escape_cache(self):
        (self.repo/'refs/main').write_text('../../elsewhere')
        self.assertEqual(qwentts._model_source(self.root,'design'),qwentts.MODELS['design'])
    def test_missing_ref_keeps_download_route(self):
        (self.repo/'refs/main').unlink()
        self.assertEqual(qwentts._model_source(self.root,'design'),qwentts.MODELS['design'])
    def test_offline_loader_receives_local_path(self):
        received=[]
        class Model:
            @staticmethod
            def from_pretrained(source,**kwargs):
                if source.startswith('Qwen/'):
                    raise AssertionError('오프라인 저장소 조회 경로가 다시 호출됐습니다.')
                received.append(source);return object()
        torch=types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda:True),bfloat16='bf16',float32='fp32')
        opts={'prompt':'숙제는 들어보셨나요?','voice_instruct':'가상 인물','voice_model':'design','language':'Korean'}
        with patch.dict(sys.modules,{'torch':torch,'qwen_tts':types.SimpleNamespace(Qwen3TTSModel=Model)}),patch.object(qwentts.common,'plan_precision',return_value={}),patch.object(qwentts.common,'log_precision'),patch.object(qwentts.common,'use_engine_cache'),patch.object(qwentts,'unload'),patch.dict(qwentts._state,{'model':None,'variant':None}):
            qwentts.load(str(self.root),opts)
        self.assertEqual(received,[str(self.snapshot.resolve())])

if __name__=='__main__':unittest.main()
