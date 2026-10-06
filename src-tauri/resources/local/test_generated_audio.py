import json, os, tempfile, unittest
from pathlib import Path
import numpy as np
from PIL import Image
import av
from generated_audio import validate_audio, save_generated_video

def tone(channels=2, samples=27000):
    t=np.arange(samples)/24000
    return np.stack([.3*np.sin(2*np.pi*(220+i*110)*t) for i in range(channels)])[None].astype(np.float32)

def save_frames(frames,path,fps):
    import subprocess
    import imageio_ffmpeg
    data=b''.join(np.asarray(frame).tobytes() for frame in frames)
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-n','-f','rawvideo','-pix_fmt','rgb24','-s','64x48','-r',str(fps),'-i','pipe:0','-an','-c:v','libx264','-threads','2','-pix_fmt','yuv420p',path],input=data,capture_output=True,check=True)

class GeneratedAudioTests(unittest.TestCase):
    def test_tail_trim_and_float_exact(self):
        a=tone();pcm,meta=validate_audio(a,24000,16,16)
        self.assertEqual(pcm.shape,(24000,2));self.assertEqual(meta['trimmed_tail_samples'],3000)
        np.testing.assert_array_equal(pcm,a[0,:,:24000].T)
    def test_bad_waveforms_fail_instead_of_silent_video(self):
        bad=[None, np.zeros((2,24000)),np.zeros((2,2,24000)),np.zeros((1,3,24000)),
             tone(samples=23999),np.ones((1,1,24000))*1.1,
             np.full((1,1,24000),np.nan),np.full((1,1,24000),np.inf),np.zeros((1,1,24000),dtype=np.int16)]
        for a in bad:
            with self.subTest(shape=getattr(a,'shape',None)),self.assertRaises(ValueError):validate_audio(a,24000,16,16)
        for rate in [None,True,0,24000.0]:
            with self.assertRaises(ValueError):validate_audio(tone(),rate,16,16)
        with self.assertRaises(ValueError):validate_audio(tone(),24000,1,29)
    def test_silent_waveform_is_explicit_and_48k_vocoder_is_supported(self):
        _,meta=validate_audio(np.zeros((1,2,48000),dtype=np.float32),48000,16,16)
        self.assertFalse(meta['signal_present']);self.assertEqual(meta['rms'],0)
        with tempfile.TemporaryDirectory() as root:
            frames=[Image.new('RGB',(64,48),(i*12,50,80)) for i in range(16)]
            audio=tone(samples=48000)
            meta=save_generated_video(frames,audio,48000,Path(root)/'48k.mp4',16,save_frames)
            self.assertEqual(meta['sample_rate'],48000);self.assertEqual(meta['samples'],48000)
    def test_real_cpu_mux_mono_stereo_and_no_overwrite(self):
        root=Path(os.environ.get('AISTORAGE_AUDIO_QA_DIR',tempfile.mkdtemp(prefix='audio-qa-')))
        root.mkdir(parents=True,exist_ok=True)
        frames=[Image.new('RGB',(64,48),(i*12,50,80)) for i in range(16)]
        for channels in [1,2]:
            output=root/f'generated-{channels}ch.mp4'
            result=save_generated_video(frames,tone(channels),24000,output,16,save_frames)
            with av.open(str(output)) as container:
                self.assertEqual(len(container.streams.audio),1)
                self.assertEqual(len(list(container.decode(video=0))),16)
            self.assertTrue(result['wav_float32_exact']);self.assertFalse(result['lip_sync_verified'])
            (root/f'generated-{channels}ch.json').write_text(json.dumps(result,indent=2),encoding='utf8')
            before=output.read_bytes()
            with self.assertRaises(FileExistsError):save_generated_video(frames,tone(channels),24000,output,16,save_frames)
            self.assertEqual(output.read_bytes(),before)
    def test_failure_does_not_publish_mp4(self):
        with tempfile.TemporaryDirectory() as root:
            output=Path(root)/'missing.mp4'
            with self.assertRaisesRegex(ValueError,'missing'):save_generated_video([None]*16,None,24000,output,16,save_frames)
            self.assertFalse(output.exists())

    def test_two_stage_final_result_keeps_audio(self):
        import sys, types
        from unittest.mock import patch
        from engines._ltx_two_stage import run_two_stage, resolution_plan
        class Scheduler:
            config={}
            @classmethod
            def from_config(cls,*args,**kwargs):return cls()
        final=types.SimpleNamespace(frames=[list(range(17))],audio=tone())
        class Pipe:
            scheduler=Scheduler()
            transformer=types.SimpleNamespace(peft_config={})
            calls=[]
            def __call__(self,**kwargs):
                self.calls.append(kwargs)
                return ('video-latent','audio-latent') if len(self.calls)==1 else final
        fake=types.ModuleType('diffusers');fake.FlowMatchEulerDiscreteScheduler=Scheduler
        utils=types.ModuleType('diffusers.pipelines.ltx2.utils');utils.STAGE_2_DISTILLED_SIGMA_VALUES=[.909375,.725,.421875]
        pipe=Pipe()
        with patch.dict(sys.modules,{'diffusers':fake,'diffusers.pipelines.ltx2.utils':utils}):
            result=run_two_stage(pipe,{'width':32,'height':32,'num_frames':17,'num_inference_steps':2,'sigmas':[1,.5]},
                resolution_plan(64,64,True),lambda x:x,lambda *x:None,lambda call:call(),None)
        self.assertIs(result,final)
        self.assertEqual(pipe.calls[1]['audio_latents'],'audio-latent')
        self.assertEqual(validate_audio(result.audio,24000,16,16)[0].shape,(24000,2))

    def test_engine_routes_final_audio_and_vocoder_rate_for_both_qualities(self):
        import types
        from contextlib import ExitStack
        from unittest.mock import patch
        from engines import ltx25
        for quality in ('single','two-stage'):
            waveform=tone()
            final=types.SimpleNamespace(frames=[list(range(17))],audio=waveform)
            class Pipe:
                vocoder=types.SimpleNamespace(config=types.SimpleNamespace(output_sampling_rate=24000))
                vae=types.SimpleNamespace(enable_tiling=lambda:None)
                def __call__(self,**kwargs):return final
            def validate_save(frames,audio,rate,output,fps,save):
                pcm,metadata=validate_audio(audio,rate,len(frames),fps)
                self.assertIs(audio,waveform)
                self.assertEqual(rate,24000)
                return metadata
            with ExitStack() as stack:
                stack.enter_context(patch.dict(ltx25._state,{'pipe':Pipe(),'plan':{},'upsampler':object()}))
                stack.enter_context(patch.object(ltx25,'_require_image_codec'))
                stack.enter_context(patch.object(ltx25,'_sampling_options',return_value={'num_inference_steps':2,'guidance_scale':1}))
                stack.enter_context(patch.object(ltx25,'run_two_stage',return_value=final))
                for name,kwargs in {'check_motion_mask':{},'resolve_seed':{'return_value':1},'generator':{'return_value':None},'step_reporter':{'return_value':None},'run_attention_safe':{'side_effect':lambda _,call:call()},'freeze_by_mask':{'side_effect':lambda frames,_:frames},'precision_fields':{'return_value':{}}}.items():
                    stack.enter_context(patch.object(ltx25.common,name,**kwargs))
                stack.enter_context(patch('generated_audio.save_generated_video',side_effect=validate_save))
                result=ltx25.generate('not-written.mp4',{'seconds':1,'fps':16,'width':128,'height':128,'ltx_quality':quality},lambda *_:None)
                self.assertEqual(result['audio']['samples'],24000)
                final.audio=None
                with self.assertRaisesRegex(ValueError,'missing'):
                    ltx25.generate('not-written.mp4',{'seconds':1,'fps':16,'width':128,'height':128,'ltx_quality':quality},lambda *_:None)

if __name__=='__main__':unittest.main()
