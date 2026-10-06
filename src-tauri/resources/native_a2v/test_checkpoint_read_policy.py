import json,tempfile,unittest,wave
from pathlib import Path
from dataclasses import replace
from a2v_adapter import prepare_app_request
from memory_budget import validate_checkpoint_read_memory,GIB
class ReadPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.audio=self.root/'original.wav'
        with wave.open(str(self.audio),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(48000);f.writeframes(bytes(130560*4))
        self.assets=[{'id':'audio','projectId':'qa','kind':'audio','filePath':str(self.audio)}]
        self.request={'engine':'ltx-a2v-native','audioAssetId':'audio','audioDurationSeconds':2.72,'fps':16,'width':384,'height':256,'offloadMode':'disk'}
    def tearDown(self):self.temp.cleanup()
    def test_requested_and_legacy_policy_records(self):
        for backend in ('mmap','pread'):
            p=prepare_app_request('qa',{**self.request,'checkpointReadBackend':backend},self.assets)
            policy=p['checkpoint_read_policy'];self.assertEqual(policy['requestedBackend'],backend);self.assertTrue(policy['explicitlySelected']);self.assertFalse(policy['automaticFallback']);self.assertEqual(policy['metadataBackend'],'pread')
            self.assertEqual((p['plan'].visible_frames,p['plan'].generation_frames),(44,49))
        with self.assertRaisesRegex(ValueError,'explicit checkpointReadBackend required'):prepare_app_request('qa',self.request,self.assets)
        legacy=prepare_app_request('qa',{**self.request,'offloadMode':'cpu'},self.assets)['checkpoint_read_policy'];self.assertEqual(legacy['payloadBackend'],'pread');self.assertIsNone(legacy['requestedBackend'])
    def test_bad_values_and_fake_implicit_mmap_fail_before_asset_access(self):
        for value in (None,True,0,'auto'):
            with self.assertRaisesRegex(ValueError,'checkpointReadBackend'):prepare_app_request('qa',{'engine':'ltx-a2v-native','checkpointReadBackend':value},[])
        with self.assertRaisesRegex(ValueError,'explicitly selected'):prepare_app_request('qa',{'engine':'ltx-a2v-native','offloadMode':'disk','checkpointReadBackend':'mmap','checkpointReadBackendExplicit':False},[])
        with self.assertRaisesRegex(ValueError,'disk'):prepare_app_request('qa',{'engine':'ltx-a2v-native','checkpointReadBackend':'pread'},[])
    def test_mmap_insufficient_commit_has_no_fallback(self):
        blob=self.root/'metadata-size-fixture';blob.write_bytes(bytes(1024))
        manifest={key:str(blob) for key in ('transformer','video_vae','audio_vae','distilled_lora','spatial_upsampler')}
        p=prepare_app_request('qa',{**self.request,'checkpointReadBackend':'mmap'},self.assets)
        with self.assertRaisesRegex(RuntimeError,'no automatic backend switch'):validate_checkpoint_read_memory(p,manifest,{'available_commit_bytes':63*GIB},0)
        result=validate_checkpoint_read_memory(p,manifest,{'available_commit_bytes':200*GIB},GIB)
        self.assertEqual(result['payloadBackend'],'mmap');self.assertEqual(result['constructorMappingAllowanceBytes'],2048);self.assertFalse(result['fullGpuPeakVerified'])
        p['checkpoint_read_policy']['payloadBackend']='pread'
        self.assertEqual(validate_checkpoint_read_memory(p,manifest,{'available_commit_bytes':200*GIB},GIB)['constructorMappingAllowanceBytes'],1024)
    def test_official_header_checks_reject_invalid_offsets_and_size(self):
        import safetensors
        # Header advertises data that the file does not contain. Supported
        # parser must reject it; no invented partial-header deserializer.
        path=self.root/'invalid.safetensors';header=json.dumps({'x':{'dtype':'F32','shape':[1],'data_offsets':[0,4]}}).encode();path.write_bytes(len(header).to_bytes(8,'little')+header)
        for backend in ('mmap','pread'):
            with self.assertRaises(safetensors.SafetensorError):safetensors.safe_open(path,framework='pt',backend=backend)
        for offsets in ([0,8],[4,0],[-1,3]):
            header=json.dumps({'x':{'dtype':'F32','shape':[1],'data_offsets':offsets}}).encode();path.write_bytes(len(header).to_bytes(8,'little')+header+bytes(4))
            with self.assertRaises(safetensors.SafetensorError):safetensors.safe_open(path,framework='pt',backend='pread')
    def test_lifetime_peak_counter_includes_current_private(self):
        from ltx_core.memory_observer import host_snapshot
        sample=host_snapshot();self.assertGreaterEqual(sample['peakPrivateCommitBytes'],sample['privateCommitBytes'])
