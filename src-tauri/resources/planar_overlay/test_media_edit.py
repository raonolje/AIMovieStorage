"""FFmpeg 합성 원본만 사용해 프레임·PCM·원본 보존을 독립 재검사합니다."""
from pathlib import Path
from fractions import Fraction
import hashlib,json,os,subprocess,sys,tempfile,unittest,wave
import numpy as np
from PIL import Image,ImageDraw
import av
from unittest.mock import patch
import media_edit as edit

FFMPEG=os.environ.get('AISTORAGE_TEST_FFMPEG','C:/ffmpeg/bin/ffmpeg.exe')

def fixture(directory,name,count=33,fps=Fraction(16),audio=True,offset=0,rate=48000,channels=2,audio_count=None):
    directory=Path(directory);images=directory/name;images.mkdir();pcm=None
    for frame in range(count):
        image=Image.new('RGB',(64,48),(40+offset,65,85))
        if frame<count-1:ImageDraw.Draw(image).rectangle((frame%40+2,18,frame%40+7,25),fill=(170,40+offset,90))
        image.save(images/f'frame-{frame:06}.png')
    path=directory/(name+'.mp4')
    command=[FFMPEG,'-nostdin','-hide_banner','-loglevel','error','-n','-framerate',str(fps),'-i',str(images/'frame-%06d.png')]
    if audio:
        n=round(float(Fraction((count if audio_count is None else audio_count)*rate,1)/fps));v=(np.arange(n,dtype=np.int64)%2000-1000).astype('<i2')
        values=np.stack([v+offset]*channels,axis=1);pcm=values.tobytes();wav=directory/(name+'.wav')
        with wave.open(str(wav),'wb') as w:w.setnchannels(channels);w.setsampwidth(2);w.setframerate(rate);w.writeframes(pcm)
        command+=['-i',str(wav),'-map','0:v','-map','1:a','-c:a','alac','-sample_fmt','s16p']
    else:command+=['-an']
    command+=['-c:v','libx264rgb','-crf','0','-threads','2','-pix_fmt','rgb24','-bf','0','-video_track_timescale',str(fps.numerator),'-frames:v',str(count),str(path)]
    subprocess.run(command,check=True,capture_output=True)
    return path,pcm

def clip(path,frames,start=0,end=None,asset='synthetic-a'):
    return {'kind':'clip','sourceVideoAssetId':asset,'sourceCutId':'synthetic-cut','sourceVideo':str(path),'sourceSha256':edit.digest(path),'sourceFrames':frames,'startFrame':start,'endFrameExclusive':end or frames}
def hold(previous,count):
    frame=previous['endFrameExclusive']-1;info=edit.probe(previous['sourceVideo'],[frame])
    return {k:previous[k] for k in ['sourceVideoAssetId','sourceCutId','sourceVideo','sourceSha256','sourceFrames']}|{'kind':'hold','frame':frame,'frames':count,'frameRgbSha256':info['selectedFrames'][0]['rgbSha256'],'reviewDeclaration':'explicitly-reviewed-frame'}
def request(segments,fps=Fraction(16),audio='clip-and-silence'):
    count=sum(s['endFrameExclusive']-s['startFrame'] if s['kind']=='clip' else s['frames'] for s in segments)
    return {'width':64,'height':48,'fps':{'numerator':fps.numerator,'denominator':fps.denominator},'segments':segments,'expectedOutputFrames':count,'audioPolicy':audio,'outputCodec':'h264-rgb-lossless'}

class MediaEditTests(unittest.TestCase):
    def test_193_model_frames_trim_to_exact_12_seconds_without_cutting_original_audio(self):
        from video_frame_contract import plan_video_frames
        plan=plan_video_frames(12,16,4)
        path,original_pcm=fixture(self.root,'model-193-original-audio-12s',count=plan['generation_frames'],audio_count=plan['target_frames'])
        before=edit.digest(path)
        result=edit.run(request([clip(path,193,end=192)]),self.root/'exact-twelve-second',FFMPEG)
        self.assertEqual(result['frames'],192)
        self.assertEqual(result['duration'],'12')
        self.assertEqual(result['audioSamples'],576000)
        self.assertEqual(result['insertedSilentSamples'],0)
        self.assertEqual(edit.pcm_decode(FFMPEG,result['video']),original_pcm)
        self.assertEqual(edit.digest(path),before)
        with av.open(result['video']) as container:
            frames=list(container.decode(video=0))
            self.assertEqual([Fraction(f.pts)*f.time_base for f in frames],[Fraction(i,16) for i in range(192)])
        self.assertFalse(result['qualityApproved'])
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();cls.root=Path(cls.tmp.name)
        cls.a,cls.pcm=fixture(cls.root,'source-a');cls.b,cls.pcm_b=fixture(cls.root,'source-b',count=9,offset=12)
        cls.c,_=fixture(cls.root,'source-no-audio',count=5,audio=False)
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def test_33_plus_143_is_176_frames_11s_and_exact_pcm(self):
        first=clip(self.a,33);req=request([first,hold(first,143)]);before=edit.digest(self.a)
        result=edit.run(req,self.root/'eleven-second',FFMPEG)
        self.assertEqual(result['frames'],176);self.assertEqual(result['duration'],'11');self.assertEqual(result['audioSamples'],528000);self.assertEqual(result['insertedSilentSamples'],429000)
        self.assertEqual(edit.pcm_decode(FFMPEG,result['video']),self.pcm+bytes(429000*4))
        with av.open(result['video']) as container:
            decoded=list(container.decode(video=0));self.assertEqual(len(decoded),176)
            for i,f in enumerate(decoded):self.assertEqual(Fraction(f.pts)*f.time_base,Fraction(i,16))
            hashes=[edit.rgb_hash(f) for f in decoded]
        self.assertEqual(len(set(hashes[32:])),1)
        self.assertEqual(result['boundaries'][1]['outputStartFrame'],33);self.assertEqual(result['boundaries'][1]['audioStartSample'],99000)
        self.assertEqual(result['audioTimeBase'],'1/48000');self.assertTrue(result['allDecodedAudioPtsVerified'])
        self.assertFalse(result['qualityApproved']);self.assertFalse(result['actualHearing']);self.assertFalse(result['continuousPlaybackVerified']);self.assertEqual(edit.digest(self.a),before)
    def test_trim_concat_hold_seams_and_source_indices(self):
        a=clip(self.a,33,3,9);b=clip(self.b,9,2,6,asset='synthetic-b');req=request([a,b,hold(b,3)])
        result=edit.run(req,self.root/'trim-concat',FFMPEG)
        self.assertEqual([f['sourceFrame'] for f in result['frameProvenance']],list(range(3,9))+list(range(2,6))+[5]*3)
        self.assertEqual([b['outputStartFrame'] for b in result['boundaries']],[0,6,10])
        expected=self.pcm[3*3000*4:9*3000*4]+self.pcm_b[2*3000*4:6*3000*4]+bytes(3*3000*4)
        self.assertEqual(edit.pcm_decode(FFMPEG,result['video']),expected)
    def test_repeat_keeps_existing_derivative_and_semantics(self):
        s=clip(self.c,5,1,4);req=request([s],audio='omit');one=edit.run(req,self.root/'repeat-one',FFMPEG);before=edit.digest(one['video'])
        with self.assertRaises(FileExistsError):edit.run(req,self.root/'repeat-one',FFMPEG)
        two=edit.run(req,self.root/'repeat-two',FFMPEG)
        self.assertEqual(edit.digest(one['video']),before);self.assertEqual(one['frameProvenance'],two['frameProvenance']);self.assertEqual(one['videoSha256'],two['videoSha256'])
    def test_hold_wrong_frame_hash_and_nonpreceding_frame_rejected(self):
        s=clip(self.a,33);h=hold(s,1);h['frameRgbSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'rgb_hash_mismatch'):edit.validate(request([s,h]))
        h=hold(s,1);h['frame']=31
        with self.assertRaisesRegex(ValueError,'previous_clip_last_frame'):edit.validate(request([s,h]))
    def test_wrong_hash_frames_dimensions_and_target_length_rejected(self):
        s=clip(self.a,33)
        for change,error in [({'sourceSha256':'f'*64},'source_hash_mismatch'),({'sourceFrames':34},'source_frame_count_mismatch')]:
            with self.assertRaisesRegex(ValueError,error):edit.validate(request([s|change]))
        for change,error in [({'width':66},'source_spec_mismatch'),({'expectedOutputFrames':34},'expected_output_frames_mismatch')]:
            with self.assertRaisesRegex(ValueError,error):edit.validate(request([s])|change)
    def test_overlap_reverse_and_bad_bounds_rejected(self):
        s=clip(self.a,33,2,8)
        with self.assertRaisesRegex(ValueError,'overlap_or_reverse'):edit.validate(request([s,clip(self.a,33,3,9)]))
        with self.assertRaisesRegex(ValueError,'invalid_clip_interval'):edit.validate(request([s|{'endFrameExclusive':35}]))
    def test_rational_timebase_no_audio_and_unaligned_audio_rejected(self):
        fps=Fraction(30000,1001);p,_=fixture(self.root,'rational',count=5,fps=fps)
        s=clip(p,5,0,1)
        with self.assertRaisesRegex(ValueError,'not_sample_aligned'):edit.validate(request([s,hold(s,4)],fps))
        req=request([clip(p,5)],fps,audio='omit');made=edit.run(req,self.root/'rational-output',FFMPEG)
        self.assertEqual(made['duration'],str(Fraction(5,1)/fps));self.assertEqual(made['outputTimeBase'],'1/30000');self.assertEqual(made['audioTracks'],0)
    def test_native_24k_mono_and_default_preservation(self):
        p,pcm=fixture(self.root,'mono',count=5,rate=24000,channels=1)
        req=request([clip(p,5)]);del req['audioPolicy']
        result=edit.run(req,self.root/'mono-out',FFMPEG)
        self.assertEqual(result['audioSampleRate'],24000);self.assertEqual(result['audioChannels'],1)
        self.assertEqual(edit.pcm_decode(FFMPEG,result['video'],24000,1),pcm)
        self.assertFalse(result['audioResampled'])
        with self.assertRaisesRegex(ValueError,'no_implicit_resampling'):
            edit.validate(request([clip(self.a,33),clip(p,5)]))
    def test_explicit_omit_mutes_audio_source(self):
        result=edit.run(request([clip(self.b,9)],audio='omit'),self.root/'explicit-mute',FFMPEG)
        self.assertEqual(result['audioTracks'],0)
        self.assertEqual(result['audioPolicy'],'omit')
        with av.open(result['video']) as container:self.assertEqual(len(container.streams.audio),0)
    def test_missing_audio_segment_adds_declared_silence(self):
        req=request([clip(self.b,9,0,2,asset='synthetic-b'),clip(self.c,5,0,2,asset='synthetic-c')]);made=edit.run(req,self.root/'mixed-audio',FFMPEG)
        self.assertEqual(made['audioTracks'],1);self.assertEqual(made['insertedSilentSamples'],6000)
        self.assertEqual(edit.pcm_decode(FFMPEG,made['video']),self.pcm_b[:6000*4]+bytes(6000*4))
    def test_cli_embedded_protocol_uses_cpu_and_preserves_sources(self):
        req=request([clip(self.c,5,2,5)],audio='omit');reqpath=self.root/'cli-request.json';reqpath.write_text(json.dumps(req),encoding='utf8')
        done=subprocess.run([sys.executable,'-B',str(Path(edit.__file__)),'--request',str(reqpath),'--output-directory',str(self.root/'cli-out'),'--ffmpeg',FFMPEG],capture_output=True,text=True,encoding='utf8',check=True)
        result=json.loads(done.stdout);self.assertEqual(result['status'],'generated');self.assertFalse(result['gpuUsed']);self.assertTrue(result['originalUnchanged'])
    def test_nonzero_or_variable_pts_is_rejected(self):
        path=self.root/'non-cfr.mp4';container=av.open(str(path),'w',options={'video_track_timescale':'16'});stream=container.add_stream('libx264rgb',rate=16);stream.width=64;stream.height=48;stream.pix_fmt='rgb24';stream.codec_context.time_base=Fraction(1,16);stream.options={'crf':'0','bf':'0'}
        for pts in [0,1,3,4]:
            frame=av.VideoFrame.from_ndarray(np.full((48,64,3),pts*20,dtype=np.uint8),format='rgb24');frame.pts=pts;frame.time_base=Fraction(1,16)
            for packet in stream.encode(frame):container.mux(packet)
        for packet in stream.encode():container.mux(packet)
        container.close()
        with self.assertRaisesRegex(ValueError,'cfr|duration'):edit.probe(path)
    def test_unicode_spaces_path_stays_separate_and_unchanged(self):
        path=self.root/'한글 원본 영상.mp4';path.write_bytes(self.a.read_bytes());before=edit.digest(path)
        result=edit.run(request([clip(path,33,2,5)]),self.root/'한글 파생 영상',FFMPEG)
        self.assertEqual(result['frames'],3);self.assertEqual(edit.digest(path),before);self.assertNotEqual(Path(result['video']),path)
    def test_changed_source_during_render_is_not_reported_success(self):
        path=self.root/'change-during-render.mp4';path.write_bytes(self.c.read_bytes());req=request([clip(path,5)],audio='omit');original_run=subprocess.run
        def changed(*args,**kwargs):
            result=original_run(*args,**kwargs)
            if 'libx264rgb' in args[0]:path.write_bytes(path.read_bytes()+b'controlled-fixture-change')
            return result
        with patch.object(edit.subprocess,'run',side_effect=changed):
            with self.assertRaisesRegex(RuntimeError,'source_changed_during_render'):edit.run(req,self.root/'source-change-out',FFMPEG)
    def test_source_audio_timestamp_gap_is_rejected(self):
        path=self.root/'audio-gap.mp4';container=av.open(str(path),'w',options={'video_track_timescale':'16'});video=container.add_stream('libx264rgb',rate=16);video.width=64;video.height=48;video.pix_fmt='rgb24';video.codec_context.time_base=Fraction(1,16);video.options={'crf':'0','bf':'0'}
        audio=container.add_stream('alac',rate=48000);audio.layout='stereo';audio.format='s16p'
        for i in range(4):
            frame=av.VideoFrame.from_ndarray(np.zeros((48,64,3),dtype=np.uint8),format='rgb24');frame.pts=i;frame.time_base=Fraction(1,16)
            for packet in video.encode(frame):container.mux(packet)
        for packet in video.encode():container.mux(packet)
        for pts in [0,4097]:
            frame=av.AudioFrame.from_ndarray(np.zeros((2,4096),dtype=np.int16),format='s16p',layout='stereo');frame.sample_rate=48000;frame.pts=pts;frame.time_base=Fraction(1,48000)
            for packet in audio.encode(frame):container.mux(packet)
        for packet in audio.encode():container.mux(packet)
        container.close()
        with self.assertRaisesRegex(ValueError,'audio_not_contiguous'):edit.probe(path)
    def test_duplicate_asset_copy_cannot_hide_source_loop(self):
        path=self.root/'alias-copy.mp4';path.write_bytes(self.c.read_bytes())
        with self.assertRaisesRegex(ValueError,'overlap_or_reverse'):edit.validate(request([clip(self.c,5),clip(path,5,asset='different-id')],audio='omit'))

if __name__=='__main__':unittest.main()
