"""실제 모델을 호출하지 않고 길이 계획과 LTX/Wan 작업자 연결을 검사합니다."""
import types, unittest
from contextlib import ExitStack
from unittest.mock import patch
from video_frame_contract import plan_video_frames, exact_video_prefix
import common
from engines import wanvideo, ltx25


class FrameContractTests(unittest.TestCase):
    def setUp(self):
        # 기존 프레임/조건 테스트는 저장 경계를 모형화한다. 실제 음원 검증은 test_generated_audio.
        from unittest.mock import patch
        saver = patch('generated_audio.save_generated_video',
            side_effect=lambda frames, audio, rate, output, fps, save: (save(frames, output, fps), {'source':'unit-test-stub'})[1])
        saver.start()
        self.addCleanup(saver.stop)

    def test_twelve_seconds_generates_193_but_delivers_192(self):
        for stride in (4, 8):
            plan = plan_video_frames(12,16,stride)
            self.assertEqual((plan['generation_frames'],plan['target_frames']), (193,192))
            frames = list(range(193))
            self.assertEqual(exact_video_prefix(frames,plan), list(range(192)))
            self.assertEqual(len(frames),193)
            self.assertEqual(plan['output_seconds'],12)
            self.assertFalse(plan['speed_changed'])

    def test_boundaries_and_small_durations(self):
        for stride in (4,8):
            for target in range(1,260):
                plan=plan_video_frames(target/16,16,stride)
                self.assertGreaterEqual(plan['generation_frames'],target)
                self.assertEqual((plan['generation_frames']-1)%stride,0)
                self.assertEqual(len(exact_video_prefix(list(range(plan['generation_frames'])),plan)),target)

    def test_invalid_or_unrepresentable_duration_is_not_rounded(self):
        for seconds,fps in [(12.1,16),(0,16),(-1,16),(float('nan'),16),(float('inf'),16),(True,16),(12,16.5),(12,True)]:
            with self.assertRaisesRegex(ValueError,'duration_contract'):
                plan_video_frames(seconds,fps,4)

    def test_short_and_excess_decoder_outputs_fail_closed(self):
        plan=plan_video_frames(12,16,4)
        for count in (189,192,194):
            with self.assertRaisesRegex(ValueError,'decoded frame count'):
                exact_video_prefix(list(range(count)),plan)

    def test_actual_engine_forwarding_and_saved_metadata(self):
        for module in (wanvideo,ltx25):
            captured={}
            def pipe(**kwargs):
                captured.update(kwargs)
                return types.SimpleNamespace(frames=[list(range(kwargs['num_frames']))])
            with ExitStack() as stack:
                stack.enter_context(patch.dict(module._state,{'pipe':pipe,'plan':{}}))
                for name,kw in {'check_motion_mask':{},'resolve_seed':{'return_value':1},'generator':{'return_value':None},'step_reporter':{'return_value':None},'run_attention_safe':{'side_effect':lambda _,call:call()},'freeze_by_mask':{'side_effect':lambda frames,_:frames},'precision_fields':{'return_value':{}}}.items():
                    stack.enter_context(patch.object(common,name,**kw))
                save=stack.enter_context(patch.object(common,'save_video'))
                if module is ltx25:
                    stack.enter_context(patch.object(module,'_require_image_codec'))
                    stack.enter_context(patch.object(module,'_sampling_options',return_value={'num_inference_steps':2,'guidance_scale':1}))
                meta=module.generate('not-created.mp4',{'seconds':12,'fps':16,'width':320,'height':192},lambda *_:None)
            self.assertEqual(captured['num_frames'],193)
            self.assertEqual(save.call_args.args,(list(range(192)),'not-created.mp4',16))
            self.assertEqual(meta['frames'],192)
            self.assertEqual(meta['seconds_video'],12)
            self.assertEqual(meta['duration_contract']['trimmed_tail_frames'],1)


if __name__=='__main__': unittest.main()
