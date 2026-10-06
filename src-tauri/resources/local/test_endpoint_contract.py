"""설치 API의 시간 인덱스와 최종 디코딩 정확성을 CPU에서 분리합니다."""
import ast,pathlib,types,sys,unittest
from unittest.mock import patch
from contextlib import ExitStack
from video_frame_contract import plan_video_frames,plan_end_condition
from engines import ltx25
from test_end_frame import ImageValue,Condition

INSTALLED=pathlib.Path('C:/Users/사용자/AppData/Roaming/com.aivideostorage.local/local/engines/ltx25/.venv/Lib/site-packages/diffusers/pipelines')


class EndpointContractTests(unittest.TestCase):
    def setUp(self):
        # 기존 프레임/조건 테스트는 저장 경계를 모형화한다. 실제 음원 검증은 test_generated_audio.
        from unittest.mock import patch
        saver = patch('generated_audio.save_generated_video',
            side_effect=lambda frames, audio, rate, output, fps, save: (save(frames, output, fps), {'source':'unit-test-stub'})[1])
        saver.start()
        self.addCleanup(saver.stop)

    def test_wan_endpoint_is_fixed_in_excluded_tail_for_twelve_seconds(self):
        endpoint=plan_end_condition('wanvideo',plan_video_frames(12,16,4))
        self.assertEqual((endpoint['condition_pixel_frame'],endpoint['last_visible_frame']),(192,191))
        self.assertFalse(endpoint['placement_exact'])
        self.assertTrue(endpoint['condition_in_trimmed_tail'])
        self.assertFalse(endpoint['decoded_final_frame_accuracy_verified'])

    def test_ltx_negative_one_is_pixel_185_not_192_or_191(self):
        endpoint=plan_end_condition('ltx25',plan_video_frames(12,16,8))
        self.assertEqual((endpoint['api_index'],endpoint['condition_pixel_frame'],endpoint['last_visible_frame']),(-1,185,191))
        self.assertFalse(endpoint['placement_exact'])
        self.assertTrue(endpoint['condition_in_visible_range'])
        self.assertFalse(endpoint['condition_in_trimmed_tail'])

    def test_representable_visible_end_gets_exact_positive_api_index(self):
        endpoint=plan_end_condition('ltx25',plan_video_frames(186/16,16,8))
        self.assertEqual((endpoint['api_index'],endpoint['condition_pixel_frame'],endpoint['last_visible_frame']),(24,185,185))
        self.assertTrue(endpoint['placement_exact'])
        self.assertFalse(endpoint['decoded_final_frame_accuracy_verified'])

    def test_wan_no_padding_has_exact_time_but_unverified_decoded_pixels(self):
        endpoint=plan_end_condition('wanvideo',plan_video_frames(193/16,16,4))
        self.assertTrue(endpoint['placement_exact'])
        self.assertFalse(endpoint['decoded_final_frame_accuracy_verified'])

    def test_installed_ltx_keyframe_time_expression_matches_contract(self):
        tree=ast.parse((INSTALLED/'ltx2/pipeline_ltx2_condition.py').read_text(encoding='utf8'))
        expr=next(n.value for n in ast.walk(tree) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='pixel_frame_idx' for t in n.targets))
        compiled=compile(ast.Expression(expr),'<installed-LTX-keyframe-time>','eval')
        for target in range(2,250):
            plan=plan_video_frames(target/16,16,8);endpoint=plan_end_condition('ltx25',plan)
            count=(plan['generation_frames']-1)//8+1
            index=endpoint['api_index']%count
            official=eval(compiled,{'__builtins__':{}},{'latent_idx':index,'frame_scale_factor':8})
            self.assertEqual(endpoint['condition_pixel_frame'],official)
            self.assertEqual(endpoint['placement_exact'],official==target-1)

    def test_installed_wan_signature_has_no_end_frame_index(self):
        tree=ast.parse((INSTALLED/'wan/pipeline_wan_i2v.py').read_text(encoding='utf8'))
        call=next(n for n in ast.walk(tree) if isinstance(n,ast.FunctionDef) and n.name=='__call__')
        names=[a.arg for a in call.args.args+call.args.kwonlyargs]
        self.assertIn('last_image',names)
        self.assertFalse(any('index' in x or 'frame_idx' in x for x in names))
        self.assertIn('num_frames - 2',ast.unparse(tree))

    def test_ltx_single_and_two_stage_forward_exact_index(self):
        for quality in ('single','two-stage'):
            captured={}
            def pipe(**kwargs):
                captured['conditions']=kwargs['conditions']
                return types.SimpleNamespace(frames=[list(range(kwargs['num_frames']))])
            def two_stage(p,kwargs,*args):
                captured['final_conditions']=args[-1]
                return pipe(**kwargs)
            pil=types.ModuleType('PIL');pil.Image=types.SimpleNamespace(open=ImageValue)
            diff=types.ModuleType('diffusers.pipelines.ltx2');diff.LTX2VideoCondition=Condition
            with ExitStack() as stack:
                stack.enter_context(patch.dict(sys.modules,{'PIL':pil,'diffusers.pipelines.ltx2':diff}))
                stack.enter_context(patch.dict(ltx25._state,{'pipe':types.SimpleNamespace(vae=types.SimpleNamespace(enable_tiling=lambda:None)) if quality=='two-stage' else pipe,'plan':{},'upsampler':object()}))
                stack.enter_context(patch('os.path.isfile',return_value=True))
                stack.enter_context(patch.object(ltx25,'_require_image_codec'))
                stack.enter_context(patch.object(ltx25,'_sampling_options',return_value={'num_inference_steps':2,'guidance_scale':1}))
                stack.enter_context(patch.object(ltx25,'run_two_stage',side_effect=two_stage))
                for name,kw in {'check_motion_mask':{},'resolve_seed':{'return_value':1},'generator':{'return_value':None},'step_reporter':{'return_value':None},'run_attention_safe':{'side_effect':lambda _,f:f()},'freeze_by_mask':{'side_effect':lambda f,_:f},'save_video':{},'precision_fields':{'return_value':{}}}.items():
                    stack.enter_context(patch.object(ltx25.common,name,**kw))
                meta=ltx25.generate('not-written.mp4',{'image':'start.png','end_image':'end.png','seconds':186/16,'fps':16,'width':320,'height':192,'ltx_quality':quality},lambda *_:None)
            self.assertEqual(captured['conditions'][-1].index,24)
            if quality=='two-stage':self.assertEqual(captured['final_conditions'][-1].index,24)
            self.assertEqual(meta['frames'],186)
            self.assertTrue(meta['end_condition_contract']['placement_exact'])


if __name__=='__main__': unittest.main()
