# -*- coding: utf-8 -*-
"""SAM 3D Body (Meta, CVPR 2026) — 한 장에서 사람의 몸·손·발 3D 를 가장 튼튼하게 뽑는 모델.

, 「업스케일링처럼 모델 선택해서
분석할 수 있게 하자 전부 다 넣어」.

뒤돈 자세·가림·특이한 자세에 가장 강하다고 발표된 모델입니다(3DPW MPJPE 54.8). 한 장씩 보는 모델이라 사람 잇기·떨림 보정은
앱이 합니다(NLF 와 같은 길). 결과 70 점(MHR70)을 몸 33 점과 양손 각각 21 점으로 나눠 보냅니다.

# 설치에서 뺀 것과 그 까닭

- **detectron2** — 원래 사람 찾기(ViTDet)에 씁니다. 윈도에서는 CUDA 툴킷으로 직접 빌드해야 하고 사용자 기계에도 툴킷이
  없습니다. 사람 찾기는 torchvision 의 Faster R-CNN(v2)으로 대신하고 상자를 모델에 넘깁니다(`process_one_image(bboxes=…)`).
- **MoGe(화각 추정)** — 없으면 기본 화각을 씁니다. 앱은 관절 방향과 몸 크기 비율만 쓰므로 화각 오차가 결과를 거의 안 바꿉니다.
- **mhr 파이썬 꾸러미** — 모델이 `mhr_model.pt`(TorchScript)로 대신 불러옵니다.

# 가중치는 승인받은 사람만

`facebook/sam-3d-body-dinov3` 는 허깅페이스에서 **접근 승인**을 받은 계정만 받습니다. 토큰은 설정 → 로컬 모델의 «허깅페이스
토큰» 에 넣으면 Rust 가 워커에 `HF_TOKEN` 으로 넘깁니다. 승인이 없으면 여기서 알아보기 쉬운 말로 멈춥니다.
"""

import os
import sys
import time

import common
from engines import _mocap

REPO = "facebook/sam-3d-body-dinov3"

# MHR70 번호(sam_3d_body/metadata/mhr70.py 의 순서) → MediaPipe 이름.
MHR_TO_MP = {
    "nose": 0, "left_eye": 1, "right_eye": 2, "left_ear": 3, "right_ear": 4,
    "left_shoulder": 5, "right_shoulder": 6, "left_elbow": 7, "right_elbow": 8,
    "left_hip": 9, "right_hip": 10, "left_knee": 11, "right_knee": 12, "left_ankle": 13, "right_ankle": 14,
    "left_foot_index": 15, "left_heel": 17, "right_foot_index": 18, "right_heel": 20,
    "right_thumb": 21, "right_index": 25, "right_pinky": 37, "right_wrist": 41,
    "left_thumb": 42, "left_index": 46, "left_pinky": 58, "left_wrist": 62,
}

# 고정한 원본의 metadata/mhr70.py 는 각 손가락을 끝→뿌리로 적습니다. 앱과 MediaPipe Hand 는
# 손목→엄지·검지·중지·약지·소지, 각 뿌리→끝이므로 묶음마다 뒤집어야 합니다.
MHR_HANDS = {
    "right": (41, 24, 23, 22, 21, 28, 27, 26, 25, 32, 31, 30, 29, 36, 35, 34, 33, 40, 39, 38, 37),
    "left": (62, 45, 44, 43, 42, 49, 48, 47, 46, 53, 52, 51, 50, 57, 56, 55, 54, 61, 60, 59, 58),
}

_state = {"estimator": None, "detector": None, "device": "cpu"}


def info(root):
    return {"repo": REPO, "notes": "가장 튼튼 · 허깅페이스 승인 토큰 필요 · 사람 찾기는 torchvision Faster R-CNN"}


def _download(root):
    """가중치를 받습니다. **429(이용 제한)는 기다렸다 다시** — 12 GB 를 받다 마지막에 걸려 처음부터 하는 일이 없게(`_hf.py`)."""
    from huggingface_hub import snapshot_download

    try:
        from engines import _hf  # 워커가 `engines.<id>` 로 불러오므로 helper 도 같은 꾸러미에서
    except ImportError:  # 옛 설치본에 helper 가 없으면 그냥 한 번만 받습니다
        _hf = None

    def once():
        kwargs = {"repo_id": REPO}
        if _hf and _hf.token():
            kwargs["token"] = _hf.token()
        return snapshot_download(**kwargs)

    try:
        if not _hf:
            return once()
        return _hf.retrying(
            once,
            on_wait=lambda seconds, attempt, text: common.log(
                "허깅페이스가 이용 제한(429)을 걸었습니다 — {}초 뒤 다시 받습니다 ({}번째)".format(seconds, attempt)
            ),
        )
    except Exception as error:  # 승인·토큰·제한 문제는 사람이 알아볼 말로
        text = str(error)
        friendly = _hf.explain(text, REPO) if _hf else None
        if friendly:
            raise RuntimeError("{} (원래 오류: {})".format(friendly, text[:200]))
        raise


def load(root, opts):
    if _state["estimator"] is not None:
        return
    import torch
    import torchvision

    source = os.path.join(root, "src")
    if not os.path.isdir(os.path.join(source, "sam_3d_body")):
        raise IOError("SAM 3D Body 코드가 없습니다. 설정 → 로컬 모델에서 다시 설치하세요: {}".format(source))
    if source not in sys.path:
        sys.path.insert(0, source)
    # torchvision 사람 찾기 가중치도 엔진 폴더 안에 받습니다(사용자 홈에 흘리지 않게).
    os.environ["TORCH_HOME"] = os.path.join(root, "models", "torch")

    from sam_3d_body import SAM3DBodyEstimator, load_sam_3d_body

    device = "cuda" if torch.cuda.is_available() else "cpu"
    folder = _download(root)
    common.log("SAM 3D Body 를 올립니다 ({}) — {}".format(device, folder))
    model, cfg = load_sam_3d_body(
        checkpoint_path=os.path.join(folder, "model.ckpt"),
        device=device,
        mhr_path=os.path.join(folder, "assets", "mhr_model.pt"),
    )
    _state["estimator"] = SAM3DBodyEstimator(model, cfg)
    weights = torchvision.models.detection.FasterRCNN_ResNet50_FPN_V2_Weights.DEFAULT
    detector = torchvision.models.detection.fasterrcnn_resnet50_fpn_v2(weights=weights, box_score_thresh=0.5)
    _state["detector"] = detector.to(device).eval()
    _state["device"] = device


def unload():
    _state["estimator"] = None
    _state["detector"] = None
    common.free_vram()


def _people_boxes(rgb, threshold):
    import torch

    tensor = torch.from_numpy(rgb).permute(2, 0, 1).float().div(255.0).to(_state["device"])
    with torch.inference_mode():
        result = _state["detector"]([tensor])[0]
    boxes = []
    for box, label, score in zip(result["boxes"].cpu().numpy(), result["labels"].cpu().numpy(), result["scores"].cpu().numpy()):
        # COCO 1 번이 사람입니다.
        if int(label) == 1 and float(score) >= threshold:
            boxes.append((box.tolist(), float(score)))
    return boxes


def _landmarks_of(person, width, height, include_hands=True):
    """몸과 손은 같은 축·골반 원점을 씁니다. 고장 난 손은 몸 전체를 버리지 않고 생략합니다."""
    import numpy as np

    try:
        k3 = np.asarray(person["pred_keypoints_3d"], dtype=np.float64)
        k2 = np.asarray(person["pred_keypoints_2d"], dtype=np.float64)
    except (KeyError, TypeError, ValueError):
        return None
    if (k3.ndim != 2 or k2.ndim != 2 or k3.shape[1] != 3 or k2.shape[1] != 2
            or min(len(k3), len(k2)) <= 62 or width <= 0 or height <= 0):
        return None
    valid = np.isfinite(k3[:63]).all(axis=1) & np.isfinite(k2[:63]).all(axis=1)
    # 원점이 망가지면 모든 관절이 NaN 이 됩니다. 이 사람만 건너뛰고 다음 사람·장은 이어갑니다.
    if not (valid[9] and valid[10]):
        return None
    # 몸에서 보던 축 보정을 손에도 똑같이 씁니다. 손만 따로 뒤집으면 손목에서 비틀립니다.
    if valid[[0, 13, 14]].all():
        down2d = (k2[13, 1] + k2[14, 1]) / 2 - k2[0, 1]
        down3d = (k3[13, 1] + k3[14, 1]) / 2 - k3[0, 1]
        if down2d * down3d < 0:
            k3 = k3 * np.array([1.0, -1.0, -1.0])
    p3 = {name: k3[i] for name, i in MHR_TO_MP.items() if valid[i]}
    p2 = {name: k2[i] for name, i in MHR_TO_MP.items() if valid[i]}
    conf = {
        name: (0.9 if 0 <= k2[i, 0] < width and 0 <= k2[i, 1] < height else 0.3)
        for name, i in MHR_TO_MP.items() if valid[i]
    }
    image, world = _mocap.to_mediapipe(p3, p2, conf, width, height, unit=1.0)
    center = (k3[9] + k3[10]) / 2
    hands = {}
    for side, indices in (MHR_HANDS.items() if include_hands else ()):
        hand = _mocap.to_hand_landmarks(k3[list(indices)], k2[list(indices)], center, width, height)
        if hand is not None:
            hands[side] = hand
    result = {"image": image, "world": world}
    if hands:
        result["hands"] = hands
    return result


def generate(output, opts, report):
    import numpy as np

    video, width, height, duration, fps, start, end = _mocap.options_of(opts)
    times = _mocap.sample_times(start, end, fps)
    estimator = _state["estimator"]
    include_hands = opts.get("hands") is not False
    threshold = float(opts.get("detector_threshold") or 0.5)
    progress = _mocap.Progress(report, len(times))
    frames_out = []
    started = time.time()

    for t, rgb in _mocap.iter_frames(video, times):
        found = _people_boxes(rgb, threshold)
        people = []
        if found:
            bboxes = np.array([box for box, _ in found], dtype=np.float32)
            # body 도 70 점을 내지만 손 전용 decoder 는 실행하지 않습니다. 손가락을 잇는
            # 지금은 공식 full 경로로 몸과 손을 함께 추정합니다(별도 모델을 받는 과정은 없음).
            outputs = estimator.process_one_image(rgb, bboxes=bboxes, inference_type="full" if include_hands else "body")
            for index, person in enumerate(outputs):
                points = _landmarks_of(person, width, height, include_hands=include_hands)
                if points is None:
                    continue
                people.append({
                    **points,
                    "score": round(found[index][1] if index < len(found) else 0.9, 3),
                    "look": [round(v, 4) for v in _mocap.look_of(points["image"], rgb)],
                })
        frames_out.append({"t": t, "people": people})
        progress.step(len(frames_out))

    summary = _mocap.write_result(output, "sam3dbody", width, height, duration, fps, start, end, frames_out)
    summary["analyze_seconds"] = round(time.time() - started, 2)
    return summary
