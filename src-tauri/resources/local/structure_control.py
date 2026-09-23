# -*- coding: utf-8 -*-
"""LTX 윤곽 기준의 시각·크기를 보존합니다. 전처리에 모델/GPU는 필요하지 않습니다."""
import math
import os


def validate_structure_control(value, opts, check_files=False):
    if not isinstance(value, dict) or value.get("kind") != "canny":
        raise ValueError("윤곽 기준 종류는 canny여야 합니다.")
    allowed = {"kind", "path", "sourceStartSeconds", "durationSeconds", "weight", "thresholds"}
    if set(value) - allowed:
        raise ValueError("윤곽 기준에 지원하지 않는 옵션이 있습니다.")
    path = value.get("path")
    if not isinstance(path, str) or not path.strip():
        raise ValueError("윤곽 기준 영상 경로를 확인해 주세요.")
    for key, default, low, high in (("sourceStartSeconds", 0, 0, 86400),
                                    ("durationSeconds", None, 1, 60), ("weight", 1, 0, 1)):
        n = value.get(key, default)
        if isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) or not low <= n <= high:
            raise ValueError("윤곽 기준의 {} 값을 확인해 주세요.".format(key))
    thresholds = value.get("thresholds", {})
    if not isinstance(thresholds, dict) or set(thresholds) - {"low", "high"}:
        raise ValueError("윤곽 임계값을 확인해 주세요.")
    low, high = thresholds.get("low", 92), thresholds.get("high", 200)
    if any(isinstance(n, bool) or not isinstance(n, int) for n in (low, high)) or not 0 <= low < high <= 255:
        raise ValueError("윤곽 임계값은 0~255이고 낮은 값이 높은 값보다 작아야 합니다.")
    seconds = opts.get("seconds", 5)
    if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds <= 0:
        raise ValueError("생성 길이를 확인해 주세요.")
    if seconds > value["durationSeconds"] + 1e-6:
        raise ValueError("생성 길이는 선택한 윤곽 기준 구간보다 길 수 없습니다.")
    if check_files and not os.path.isfile(path):
        raise IOError("윤곽 기준 영상을 찾지 못했습니다: {}".format(path))


def _video_info(container, value):
    streams = list(container.streams.video)
    if not streams:
        raise ValueError("윤곽 기준 파일에 영상 스트림이 없습니다.")
    stream = streams[0]
    duration = float(stream.duration * stream.time_base) if stream.duration is not None else (
        float(container.duration) / 1_000_000 if container.duration is not None else 0)
    fps = float(stream.average_rate or stream.guessed_rate or 0)
    if not math.isfinite(duration) or duration <= 0 or not math.isfinite(fps) or not 0 < fps <= 240:
        raise ValueError("윤곽 기준 영상의 길이와 프레임 속도를 확인하지 못했습니다.")
    start = float(value.get("sourceStartSeconds", 0))
    end = start + float(value["durationSeconds"])
    if end > duration + 1e-6 or start >= duration:
        raise ValueError("윤곽 기준 구간이 원본 영상 길이를 벗어났습니다 ({:.3f}초).".format(duration))
    return stream, {"source_duration_seconds": duration, "source_fps": fps,
                    "source_start_seconds": start, "source_end_seconds": end}


def probe_structure_video(value, opts):
    """모델을 올리기 전에 범위/필수 패키지를 확인합니다. 디코드는 생성 전처리에서만 합니다."""
    validate_structure_control(value, opts, check_files=True)
    try:
        import av
        import cv2  # noqa: F401
    except ImportError as error:
        raise RuntimeError("윤곽 구조 제어에는 PyAV와 OpenCV가 필요합니다. LTX 2.5를 다시 설치해 주세요.") from error
    with av.open(value["path"]) as container:
        _, info = _video_info(container, value)
    return info


def _sample_at_times(decoded, targets, start, end, frame_seconds):
    """PTS로 가장 가까운 프레임을 고릅니다. 선택 구간 밖 프레임이나 끝 정지 패딩을 만들지 않습니다."""
    previous = None
    position = 0
    for timestamp, frame in decoded:
        if not math.isfinite(timestamp):
            raise ValueError("윤곽 기준 프레임에 유효한 시각이 없습니다.")
        if previous is not None and timestamp <= previous[0]:
            raise ValueError("윤곽 기준 프레임의 시각 순서가 잘못되었습니다.")
        if timestamp < start - 1e-6:
            continue
        if timestamp >= end - 1e-6:
            break
        if previous is None and timestamp > targets[0] + frame_seconds + 1e-6:
            raise ValueError("윤곽 기준 영상에서 선택한 시작 프레임이 누락됐습니다.")
        while position < len(targets) and targets[position] <= timestamp:
            chosen = previous if previous is not None and targets[position] - previous[0] <= timestamp - targets[position] else (timestamp, frame)
            yield chosen
            position += 1
        previous = (timestamp, frame)
        if position == len(targets):
            return
    # 마지막 실제 프레임이 원본의 남은 표시 시간을 담당합니다. 파일 길이 밖으로 늘이지 않습니다.
    # 파일 헤더 길이와 달리 디코드가 일찍 끝난 파일을 마지막 한 장으로 채우면 안 됩니다.
    last_end = previous[0] + frame_seconds if previous else start
    if previous is not None:
        duration = getattr(previous[1], "duration", None)
        time_base = getattr(previous[1], "time_base", None)
        if duration and time_base:
            last_end = previous[0] + float(duration * time_base)
    while previous is not None and position < len(targets) and targets[position] < min(end, last_end) + 1e-6:
        yield previous
        position += 1
    if position != len(targets):
        raise ValueError("선택한 구간에서 윤곽 기준 프레임을 읽지 못했습니다.")


def canny_reference_frames(value, opts, width, height, frames, output_fps, reference_factor=2, report=None):
    import av
    import cv2
    import numpy as np
    from PIL import Image

    validate_structure_control(value, opts, check_files=True)
    if not math.isfinite(output_fps) or not 1 <= output_fps <= 60 or frames < 1:
        raise ValueError("윤곽 기준의 출력 프레임 수와 속도를 확인해 주세요.")
    # 과도한 길이/해상도로 CPU 참조 배열이 RAM을 고갈시키는 것을 모델 호출 전에 막습니다.
    ref_width, ref_height = width // reference_factor, height // reference_factor
    if ref_width * ref_height * frames > 300_000_000:
        raise ValueError("윤곽 기준의 길이나 해상도를 줄여 주세요. 참조 프레임 메모리 한도를 넘습니다.")
    thresholds = value.get("thresholds", {})
    low, high = thresholds.get("low", 92), thresholds.get("high", 200)
    with av.open(value["path"]) as container:
        stream, info = _video_info(container, value)
        start, end = info["source_start_seconds"], info["source_end_seconds"]
        targets = [start + index / output_fps for index in range(frames)]
        if targets[-1] >= end or frames / output_fps > value["durationSeconds"] + 1e-6:
            raise ValueError("출력 프레임이 선택한 윤곽 기준 구간보다 깁니다.")
        origin = float((stream.start_time or 0) * stream.time_base)
        # 시작점 직전 키프레임까지만 돌아갑니다. 69초 원본을 앞에서 전부 읽지 않습니다.
        container.seek(int((start + origin) / float(stream.time_base)), stream=stream, backward=True, any_frame=False)
        decoded_count = 0

        def decoded():
            nonlocal decoded_count
            for frame in container.decode(stream):
                decoded_count += 1
                if decoded_count > 30_000:
                    raise ValueError("윤곽 기준의 키프레임 간격이 너무 깁니다. 짧은 프록시 영상을 사용해 주세요.")
                if frame.pts is None:
                    raise ValueError("윤곽 기준 프레임에 시각 정보가 없습니다.")
                yield float(frame.pts * stream.time_base) - origin, frame

        output, sampled_times = [], []
        cached_time, cached_image = None, None
        for timestamp, frame in _sample_at_times(decoded(), targets, start, end, 1 / info["source_fps"]):
            if timestamp != cached_time:
                rgb = frame.to_ndarray(format="rgb24")
                # 첫 장면과 같은 전체 출력 눈금에서 윤곽을 찾고 Union의 절반 눈금으로 줄입니다.
                rgb = cv2.resize(rgb, (width, height), interpolation=cv2.INTER_AREA)
                # 공식 Canny 주석기처럼 RGB 채널의 경계를 보존합니다. 먼저 회색으로 바꾸면
                # 밝기가 비슷한 서로 다른 색의 인물/배경 경계가 사라질 수 있습니다.
                edges = cv2.Canny(rgb, low, high)
                edge_image = Image.fromarray(np.repeat(edges[:, :, None], 3, axis=2))
                cached_image = edge_image.resize((ref_width, ref_height), Image.Resampling.LANCZOS)
                cached_time = timestamp
            output.append(cached_image)
            sampled_times.append(timestamp)
            if report and (len(output) == 1 or len(output) % 24 == 0):
                report(0, "윤곽 기준 준비 {}/{}".format(len(output), frames))
    return output, dict(info, kind="canny", low_threshold=low, high_threshold=high,
                        output_fps=output_fps, conditioning_frames=len(output),
                        conditioning_seconds=len(output) / output_fps,
                        first_sample_seconds=sampled_times[0], last_sample_seconds=sampled_times[-1],
                        decoded_frames=decoded_count, resize="stretch-to-output-then-half",
                        annotation_width=width, annotation_height=height,
                        reference_width=ref_width, reference_height=ref_height,
                        weight=float(value.get("weight", 1)), sampling="nearest-pts-in-range")
