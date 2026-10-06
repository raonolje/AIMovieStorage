"""모델의 생성 프레임과 사용자가 요청한 출력 길이를 구별합니다. GPU를 사용하지 않습니다."""
from fractions import Fraction


def plan_video_frames(seconds, fps, stride):
    if isinstance(fps, bool) or not isinstance(fps, int) or not 1 <= fps <= 60:
        raise ValueError('duration_contract: fps must be an integer in 1..60')
    if isinstance(seconds, bool):
        raise ValueError('duration_contract: seconds must be positive and finite')
    try:
        duration = Fraction(str(seconds))
    except (ValueError, ZeroDivisionError):
        raise ValueError('duration_contract: seconds must be positive and finite') from None
    if duration <= 0:
        raise ValueError('duration_contract: seconds must be positive and finite')
    target = duration * fps
    if target.denominator != 1:
        # 속도·fps 변경이나 조용한 반올림으로 정확한 길이를 가장하지 않습니다.
        raise ValueError('duration_contract: requested duration is not frame aligned at this fps')
    target = int(target)
    generated = max(stride + 1, ((target - 1 + stride - 1) // stride) * stride + 1)
    return {'requested_seconds': float(duration), 'fps': fps,
            'target_frames': target, 'generation_frames': generated,
            'trimmed_tail_frames': generated - target,
            'output_seconds': float(Fraction(target, fps)),
            'policy': 'ceil-model-frames-then-prefix-trim', 'speed_changed': False}


def exact_video_prefix(frames, plan):
    actual = len(frames)
    if actual != plan['generation_frames']:
        raise ValueError('duration_contract: decoded frame count differs from generation plan '
                         f"({actual} != {plan['generation_frames']})")
    # 프레임 복제·보간·재생속도 변경 없이 모델 양자화로 추가된 꼬리만 제외합니다.
    return frames[:plan['target_frames']]


def plan_end_condition(engine, plan):
    """설치된 공개 API의 시간 위치만 판정합니다. 디코딩 픽셀 일치를 보장하지 않습니다."""
    last_visible = plan['target_frames'] - 1
    if engine == 'wanvideo':
        condition_pixel = plan['generation_frames'] - 1
        api_index = None
        api = 'fixed-generated-last-image'
    elif engine == 'ltx25':
        # Diffusers 0.40: latent index j>0의 keyframe 시간은 (j-1)*8+1입니다.
        latent_count = (plan['generation_frames'] - 1) // 8 + 1
        if last_visible == 0:
            api_index = 0
        elif (last_visible - 1) % 8 == 0:
            api_index = (last_visible - 1) // 8 + 1
        else:
            # 공개 API로 임의 픽셀 시간은 지정할 수 없습니다. 기존 -1 동작을 유지합니다.
            api_index = -1
        resolved = api_index % latent_count
        condition_pixel = 0 if resolved == 0 else (resolved - 1) * 8 + 1
        api = 'latent-index-grid-0-or-1-plus-8k'
    else:
        raise ValueError('unsupported_end_condition_api')
    return {'api': api, 'api_index': api_index,
            'condition_pixel_frame': condition_pixel, 'last_visible_frame': last_visible,
            'placement_exact': condition_pixel == last_visible,
            'condition_in_visible_range': condition_pixel <= last_visible,
            'condition_in_trimmed_tail': condition_pixel > last_visible,
            'decoded_final_frame_accuracy_verified': False}
