# -*- coding: utf-8 -*-
"""앞부분을 선택한 H3 참조는 전체 영상을 RAM 에 올리지 않고 읽습니다."""
import math


def _duration(container, stream):
    if stream.duration is not None and stream.time_base is not None:
        value = float(stream.duration * stream.time_base)
    else:
        value = float(container.duration) / 1000000 if container.duration is not None else None
    return value if value is not None and math.isfinite(value) and value > 0 else None


def _soundtrack_prefix(av, path, seconds):
    import numpy as np
    import torch

    with av.open(path) as container:
        if not container.streams.audio:
            return None, None
        stream = container.streams.audio[0]
        rate = int(stream.codec_context.sample_rate)
        if rate <= 0:
            raise ValueError("레퍼런스 영상의 소리 표본율을 읽지 못했습니다.")
        remaining = int(math.floor(seconds * rate))
        resampler = av.audio.resampler.AudioResampler(format="fltp", layout=stream.layout, rate=rate)
        chunks = []

        def append(frames):
            nonlocal remaining
            for frame in frames:
                if remaining <= 0:
                    break
                samples = frame.to_ndarray()[:, :remaining]
                chunks.append(samples)
                remaining -= samples.shape[-1]

        for frame in container.decode(stream):
            append(resampler.resample(frame))
            if remaining <= 0:
                break
        if remaining > 0:
            append(resampler.resample(None))
        return (torch.from_numpy(np.concatenate(chunks, axis=-1)).float(), rate) if chunks else (None, None)


def load_video_reference(path, selection, reference_class, generated_frames, target_fps=24):
    import av
    import numpy as np

    if selection not in ("first5s", "full"):
        raise ValueError("H3 영상 레퍼런스의 앞 5초 또는 전체를 선택해 주세요.")
    with av.open(path) as container:
        if not container.streams.video:
            raise ValueError("레퍼런스에 영상 트랙이 없습니다.")
        stream = container.streams.video[0]
        source_reported = _duration(container, stream)
        if selection == "first5s":
            fps = float(stream.average_rate or stream.guessed_rate or 0)
            if not math.isfinite(fps) or fps <= 0:
                raise ValueError("레퍼런스 영상의 초당 프레임 수를 읽지 못했습니다.")
            # H3 는 fps 로 시간을 다시 만들므로 실제 시각과 장 수를 함께 제한합니다.
            # 원본이 VFR 이어도 5초 뒤 프레임을 읽어 조건으로 넣지 않습니다.
            limit = int(math.floor(5 * fps))
            frames, first_time, rotation = [], None, 0
            for frame in container.decode(stream):
                if first_time is None and frame.time is not None:
                    first_time = frame.time
                elapsed = frame.time - first_time if frame.time is not None and first_time is not None else len(frames) / fps
                if elapsed >= 5 or len(frames) >= limit:
                    break
                rotation = getattr(frame, "rotation", 0)
                frames.append(frame.to_ndarray(format="rgb24"))
                if len(frames) >= limit:
                    break
            if not frames:
                raise ValueError("레퍼런스 영상의 앞 5초에서 프레임을 읽지 못했습니다.")
            frames = np.stack(frames)
            turns = round(rotation / 90) % 4
            if turns:
                frames = np.ascontiguousarray(np.rot90(frames, k=-turns, axes=(1, 2)))
        else:
            frames = None
    if frames is None:
        # 전체 선택은 기존 공식 디코더 그대로입니다. 암묵적인 앱 쪽 자르기는 없습니다.
        reference = reference_class.from_file(path)
    else:
        audio, rate = _soundtrack_prefix(av, path, len(frames) / fps)
        reference = reference_class(frames=frames, fps=fps, audio=audio, sample_rate=rate)
    count = len(reference.frames)
    fps = float(reference.fps)
    if count < 1 or not math.isfinite(fps) or fps <= 0:
        raise ValueError("레퍼런스 영상의 길이를 읽지 못했습니다.")
    # 설치된 공식 H3 _normalize_video_condition 의 24fps 반올림·생성 길이 제한입니다.
    # 앞 5초를 채우려고 원본 뒤쪽 프레임을 보태거나 같은 장면을 반복하지 않습니다.
    conditioning_frames = min(generated_frames, int(math.floor(count * target_fps / fps + 0.5)))
    metadata = {
        "range": selection,
        "source_reported_seconds": source_reported,
        "decoded_frames": count,
        "decoded_seconds": round(count / fps, 6),
        "source_fps": fps,
        "conditioning_frames": conditioning_frames,
        "conditioning_seconds": round(conditioning_frames / target_fps, 6),
        "conditioning_fps": target_fps,
        "has_audio": reference.audio is not None,
        "audio_seconds": round(reference.audio.shape[-1] / reference.sample_rate, 6) if reference.audio is not None and reference.sample_rate else None,
    }
    return reference, metadata
