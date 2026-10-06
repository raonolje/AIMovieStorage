import tempfile, unittest, wave
from pathlib import Path
from a2v_adapter import prepare_app_request, write_audio_segments
from memory_budget import validate_host_memory, GIB

class NativeDiskTests(unittest.TestCase):
    def test_disk_keeps_full_source_samples_and_frame_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'full.wav'
            pcm=b'\x01\x00\x02\x00'*130560
            with wave.open(str(source),'wb') as output:
                output.setnchannels(2);output.setsampwidth(2);output.setframerate(48000);output.writeframes(pcm)
            assets=[{'id':'audio','projectId':'qa','kind':'audio','filePath':str(source)}]
            request={'engine':'ltx-a2v-native','audioAssetId':'audio','audioDurationSeconds':2.72,'fps':16,'offloadMode':'disk'}
            prepared=prepare_app_request('qa',request,assets)
            self.assertEqual(prepared['offload_mode'],'disk')
            self.assertEqual((prepared['plan'].visible_frames,prepared['plan'].generation_frames),(44,49))
            destination=root/'segments';destination.mkdir();result=write_audio_segments(prepared['plan'],destination)
            with wave.open(result['original_segment'],'rb') as original:self.assertEqual(original.readframes(original.getnframes()),pcm)
            with wave.open(result['conditioning'],'rb') as conditioning:
                data=conditioning.readframes(conditioning.getnframes())
                self.assertEqual(data[:len(pcm)],pcm);self.assertEqual(data[len(pcm):],bytes(16440*4))
            self.assertEqual(prepare_app_request('qa',{k:v for k,v in request.items() if k!='offloadMode'},assets)['offload_mode'],'cpu')
    def test_invalid_mode_rejected_before_path_resolution(self):
        for mode in ['none','fp8',True,3]:
            with self.assertRaisesRegex(ValueError,'offloadMode'):
                prepare_app_request('qa',{'engine':'ltx-a2v-native','offloadMode':mode},[])
    def test_resource_guard_separates_physical_ram_and_commit(self):
        available={'available_physical_bytes':90*GIB,'available_commit_bytes':120*GIB}
        self.assertEqual(validate_host_memory('disk',available)['required_free_host_bytes'],64*GIB)
        with self.assertRaisesRegex(RuntimeError,'insufficient_host_memory'):validate_host_memory('cpu',available)
        for field in ['available_physical_bytes','available_commit_bytes']:
            with self.assertRaisesRegex(RuntimeError,'insufficient_host_memory'):validate_host_memory('disk',available|{field:63*GIB})

if __name__=='__main__':unittest.main()
