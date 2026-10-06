import unittest,tempfile,json,subprocess
from pathlib import Path
from unittest.mock import patch
import numpy as np
from PIL import Image
import av
from fractions import Fraction
import planar_overlay as overlay

class PlanarOverlayTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.source=self.root/'source.mp4';self.image=self.root/'screen.png'
        with av.open(str(self.source),'w') as out:
            stream=out.add_stream('libx264',rate=16);stream.width=64;stream.height=48;stream.pix_fmt='yuv420p'
            for i in range(3):
                frame=av.VideoFrame.from_ndarray(np.full((48,64,3),30+i,dtype=np.uint8),format='rgb24');frame.pts=i;frame.time_base=Fraction(1,16)
                for packet in stream.encode(frame):out.mux(packet)
            for packet in stream.encode():out.mux(packet)
        Image.new('RGBA',(32,24),(120,150,200,255)).save(self.image)
        self.request={'sourceVideo':str(self.source),'replacementImage':str(self.image),'sourceSha256':overlay.digest(self.source),'replacementSha256':overlay.digest(self.image),'width':64,'height':48,'fps':16,'frames':3,'coordinates':[{'frame':i,'timeSeconds':i/16,'quad':[[10,8],[52,8],[50,40],[8,40]]}for i in range(3)],'contentMode':'non-text'}
    def tearDown(self):self.temp.cleanup()
    def test_rgba_alpha_preserves_every_zero_alpha_pixel(self):
        original=Image.fromarray(np.arange(64*48*3,dtype=np.uint8).reshape(48,64,3));replacement=Image.open(self.image)
        made,safe,alpha=overlay.composite_frame(original,replacement,self.request['coordinates'][0]['quad'])
        self.assertTrue(np.array_equal(np.asarray(made)[alpha==0],np.asarray(original)[alpha==0]))
        self.assertTrue((alpha[np.asarray(safe)==0]==0).all())
        self.assertGreater(alpha.max(),.99)
    def test_homography_maps_supplied_four_corners(self):
        q=self.request['coordinates'][0]['quad'];c=overlay.warp_coefficients(q,(32,24))
        for (x,y),(u,v) in zip(q,[(0,0),(31,0),(31,23),(0,23)]):
            den=c[6]*x+c[7]*y+1
            self.assertAlmostEqual((c[0]*x+c[1]*y+c[2])/den,u,places=7);self.assertAlmostEqual((c[3]*x+c[4]*y+c[5])/den,v,places=7)
    def test_preflight_reads_actual_source_frames_and_timing(self):overlay.validate_input(self.request)
    def test_missing_hash_spec_and_frame_checks_reject_before_output(self):
        for field,value,match in [('sourceSha256','0'*64,'hash'),('replacementSha256','0'*64,'hash'),('width',66,'spec'),('fps',24,'time|spec'),('frames',4,'missing_quad')]:
            r={**self.request,field:value}
            with self.subTest(field=field),self.assertRaisesRegex(ValueError,match):overlay.validate_input(r)
        for index in [0,1]:
            r=json.loads(json.dumps(self.request));r['coordinates'][index]['frame']=9
            with self.assertRaisesRegex(ValueError,'frame_index'):overlay.validate_input(r)
    def test_invalid_geometry_rejects(self):
        for q in [[[10,8],[8,40],[50,40],[52,8]],[[10,8],[50,40],[52,8],[8,40]],[[-1,8],[52,8],[50,40],[8,40]],[[10,8],[10,8],[10,8],[10,8]],[[0,0],[63,0],[63,47],[0,47]]]:
            with self.subTest(q=q),self.assertRaisesRegex(ValueError,'invalid_quad'):overlay.quad_checked(q,64,48)
    def test_transparent_replacement_never_changes_original(self):
        original=Image.new('RGB',(64,48),(50,80,130));replacement=Image.new('RGBA',(32,24),(250,30,10,0))
        made,_,alpha=overlay.composite_frame(original,replacement,self.request['coordinates'][0]['quad'])
        self.assertTrue(np.array_equal(np.asarray(made),np.asarray(original)));self.assertEqual(alpha.max(),0)
    def test_non_rgba_and_pts_are_not_silently_converted(self):
        Image.new('RGB',(32,24)).save(self.image);self.request['replacementSha256']=overlay.digest(self.image)
        with self.assertRaisesRegex(ValueError,'RGBA'):overlay.validate_input(self.request)
    def test_existing_output_is_preserved(self):
        output=self.root/'keep';output.mkdir();(output/'original.txt').write_text('keep')
        with self.assertRaises(FileExistsError):overlay.run(self.request,output,'unused')
        self.assertEqual((output/'original.txt').read_text(),'keep')
    def test_budget_and_content_policy_reject(self):
        for changed in [{'width':8192,'height':8192},{'contentMode':'exact-text'},{'contentMode':'non-text','requiredText':'한국사'},{'target':{'id':'guho-cut-03-02'}}]:
            with self.subTest(changed=changed),self.assertRaisesRegex(ValueError,'budget|content'):
                overlay.validate_input({**self.request,**changed})
    def test_cpu_render_preserves_original_audio_packets_and_timing(self):
        ffmpeg='C:/ffmpeg/bin/ffmpeg.exe';audio_source=self.root/'with-audio.mp4'
        subprocess.run([ffmpeg,'-nostdin','-loglevel','error','-i',str(self.source),'-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.3','-map','0:v','-map','1:a','-c:v','copy','-c:a','alac',str(audio_source)],check=True)
        request={**self.request,'sourceVideo':str(audio_source),'sourceSha256':overlay.digest(audio_source)}
        report=overlay.run(request,self.root/'render',ffmpeg)
        def packets(path):
            with av.open(str(path)) as container:
                stream=container.streams.audio[0]
                return [(bytes(p),p.pts*p.time_base,p.duration*p.time_base) for p in container.demux(stream) if p.size]
        self.assertEqual(packets(audio_source),packets(report['video']))
        self.assertEqual(report['frames'],3);self.assertEqual(report['durationSeconds'],3/16)
        self.assertEqual(overlay.digest(audio_source),request['sourceSha256']);self.assertFalse(report['gpuUsed'])
if __name__=='__main__':unittest.main()
