# -*- coding: utf-8 -*-
"""큰 모델을 올리기 전에 지원하지 않는 동작 입력을 거절합니다. torch를 불러오지 않습니다."""
import math
import os


def validate_control_options(engine_id, opts, check_files=False):
    if not isinstance(opts, dict):
        raise ValueError("생성 옵션은 객체여야 합니다.")
    control = opts.get("control")
    if control is not None:
        if engine_id != "ltx25":
            raise ValueError("이 엔진은 모캡 뼈 프레임을 받지 않습니다. LTX 2.5를 고르거나 동작 기준을 해제하세요.")
        if not isinstance(control, dict) or control.get("kind") != "pose":
            raise ValueError("지원하는 동작 기준은 pose 뼈 프레임입니다.")
        paths = control.get("frames")
        if not isinstance(paths, list) or not 1 <= len(paths) <= 4096 or any(not isinstance(p, str) or not p.strip() for p in paths):
            raise ValueError("동작 기준의 뼈 프레임 경로를 확인해 주세요.")
        for key, low, high in (("weight", 0, 1.5), ("fps", 0.1, 240)):
            if key not in control:
                continue
            value = control[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
                raise ValueError("동작 기준의 {} 값을 확인해 주세요.".format(key))
        if check_files:
            missing = next((p for p in paths if not os.path.isfile(p)), None)
            if missing:
                raise IOError("뼈 그림을 찾지 못했습니다: {}".format(missing))
    references = opts.get("references")
    if references and engine_id != "minimaxh3":
        raise ValueError("이 엔진은 레퍼런스 목록을 받지 않습니다. 첫 장면 그림 또는 지원되는 동작 기준으로 연결해 주세요.")
    has_video = isinstance(references, list) and any(isinstance(item, dict) and item.get("kind") == "video" for item in references)
    selection = opts.get("reference_video_range")
    if has_video and engine_id == "minimaxh3" and selection not in ("first5s", "full"):
        raise ValueError("H3 영상 레퍼런스의 앞 5초 또는 전체를 선택해 주세요.")
    if selection is not None and (engine_id != "minimaxh3" or not has_video):
        raise ValueError("레퍼런스 구간은 H3 영상 레퍼런스가 있을 때만 선택할 수 있습니다.")
