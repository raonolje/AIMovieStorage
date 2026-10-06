"""별도 native API의 표시 프레임 조건 전달만 검사합니다. GPU/모델을 사용하지 않습니다."""
import ast,pathlib,tempfile,wave,unittest
import a2v_adapter


class NativeVisibleEndpointTests(unittest.TestCase):
    def test_twelve_second_native_request_targets_pixel_191_before_pad_192(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);wav=root/'audio.wav'
            with wave.open(str(wav),'wb') as w:
                w.setnchannels(2);w.setsampwidth(2);w.setframerate(48000);w.writeframes(bytes(576000*4))
            images=[root/'first.png',root/'end.png']
            for image in images:image.write_bytes(b'CPU contract fixture')
            assets=[{'id':'audio','projectId':'qa','kind':'audio','filePath':str(wav)}]+[{'id':name,'projectId':'qa','kind':'image','filePath':str(image)} for name,image in zip(['first','end'],images)]
            request={'engine':'ltx-a2v-native','audioAssetId':'audio','imageAssetId':'first','endImageAssetId':'end','audioStartSeconds':0,'audioDurationSeconds':12,'fps':16,'width':768,'height':512,'seed':1}
            prepared=a2v_adapter.prepare_app_request('qa',request,assets)
            self.assertEqual((prepared['plan'].visible_frames,prepared['plan'].generation_frames),(192,193))
            self.assertEqual(prepared['images'][-1][1],191)

    def test_installed_native_api_keeps_pixel_frame_index(self):
        root=pathlib.Path(__file__).resolve().parent/'sdk_candidate'
        helper=ast.parse((root/'ltx_pipelines/utils/helpers.py').read_text(encoding='utf8'))
        calls=[n for n in ast.walk(helper) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='VideoConditionByKeyframeIndex']
        self.assertTrue(any(any(k.arg=='frame_idx' and ast.unparse(k.value)=='img.frame_idx' for k in call.keywords) for call in calls))
        body=ast.parse((root/'ltx_core/conditioning/types/keyframe_cond.py').read_text(encoding='utf8'))
        self.assertTrue(any(isinstance(n,ast.AugAssign) and ast.unparse(n.value)=='self.frame_idx' and isinstance(n.op,ast.Add) for n in ast.walk(body)))


if __name__=='__main__':unittest.main()
