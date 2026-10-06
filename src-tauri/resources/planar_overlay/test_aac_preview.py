import unittest,tempfile,subprocess
import sys
from types import SimpleNamespace
from fractions import Fraction
from pathlib import Path
from aac_preview import export,digest,inspect

class PreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.root=Path(cls.temp.name);cls.master=cls.root/'master.mp4'
        subprocess.run(['C:/ffmpeg/bin/ffmpeg.exe','-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','testsrc2=size=64x48:rate=16','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.25','-c:v','libx264','-bf','0','-pix_fmt','yuv420p','-c:a','alac','-video_track_timescale','48000',str(cls.master)],check=True,capture_output=True)
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()
    def test_exact_video_and_audio_timeline_with_declared_lossy_padding(self):
        request={'sourceVideo':str(self.master),'sourceSha256':digest(self.master)}
        made=export(request,self.root/'preview','C:/ffmpeg/bin/ffmpeg.exe')
        self.assertEqual(made['videoFrames'],20);self.assertEqual(made['duration'],'5/4');self.assertEqual(made['timelineSamples'],60000)
        self.assertTrue(made['allVideoPacketsExact']);self.assertTrue(made['allDecodedFramesExact']);self.assertTrue(made['lossyAudio']);self.assertEqual(made['encoderDelaySamples'],1024)
        self.assertLess(made['decoderTailPaddingSamples'],1024);self.assertEqual(digest(self.master),request['sourceSha256'])
        with self.assertRaisesRegex(ValueError,'existing_output'):export(request,self.root/'preview','C:/ffmpeg/bin/ffmpeg.exe')
    def test_hash_rejected_before_output(self):
        with self.assertRaisesRegex(ValueError,'source_hash_mismatch'):export({'sourceVideo':str(self.master),'sourceSha256':'0'*64},self.root/'rejected','C:/ffmpeg/bin/ffmpeg.exe')
        self.assertFalse((self.root/'rejected').exists())
    def test_network_input_rejected(self):
        with self.assertRaisesRegex(ValueError,'invalid_local_master'):export({'sourceVideo':'https://invalid/master.mp4','sourceSha256':'0'*64},self.root/'network','C:/ffmpeg/bin/ffmpeg.exe')
    def test_short_last_video_packet_preserved(self):
        sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'native_a2v'))
        from a2v_adapter import precise_duration_remux
        intermediate=self.root/'partial-intermediate.mp4';master=self.root/'partial-master.mp4'
        subprocess.run(['C:/ffmpeg/bin/ffmpeg.exe','-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','testsrc2=size=64x48:rate=16','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2.72','-c:v','libx264','-bf','0','-pix_fmt','yuv420p','-c:a','alac','-video_track_timescale','48000',str(intermediate)],check=True,capture_output=True)
        precise_duration_remux(intermediate,master,SimpleNamespace(start_sample=0,end_sample=130560,sample_rate=48000))
        self.assertEqual(Fraction(inspect(master)['videoPackets'][-1]['duration']),Fraction(1560,48000))
        made=export({'sourceVideo':str(master),'sourceSha256':digest(master)},self.root/'partial-preview','C:/ffmpeg/bin/ffmpeg.exe')
        self.assertEqual(made['videoFrames'],44);self.assertEqual(made['duration'],'68/25');self.assertEqual(made['timelineSamples'],130560)

if __name__=='__main__':unittest.main()
