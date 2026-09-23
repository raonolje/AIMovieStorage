# -*- coding: utf-8 -*-
"""모션 캡처 엔진(NLF · SAM 3D Body · GVHMR)이 함께 쓰는 몸통.



엔진마다 **사람을 보는 모델만** 다릅니다. 영상 넘기기·결과 모양·옷 색·점 번호 맞추기는 여기 한 군데에 둡니다 —
앱 규칙 1 과 같은 까닭입니다. 엔진 셋이 결과 모양을 제각각 내면 앱의 이어 붙이기·튐 보정·리타깃을 엔진마다 고쳐야 합니다.

# 결과 파일(앱의 `motionCapture.assembleCapture` 가 읽음)

    { "width", "height", "duration", "fps", "start", "end", "engine",
      "frames": [ { "t": 초, "people": [ { "image": [[x,y,v]×33], "world": [[x,y,z,v]×33],
                                          "score": 0~1, "look": [6] } ] } ] }

- 점은 **MediaPipe 33점 순서**. 모델마다 다른 관절 체계(SMPL 24점·MHR 70점)를 여기서 맞춥니다.
- image 는 0~1(가로·세로), world 는 **미터 · 골반 가운데 원점 · x 오른쪽 · y 아래 · z 카메라에서 멀어지는 쪽**
  (OpenCV 카메라 방향 = MediaPipe world 와 같은 방향).
- 사람 사이 잇기는 앱이 합니다. 여기서는 장마다 찾은 사람을 전부 적습니다.
- 손 전용 결과가 있으면 사람의 hands.left/right 에 {image: 21점, world: 21점} 을 더합니다.
  순서는 MediaPipe Hand(손목·엄지·검지·중지·약지·소지, 각 뿌리→끝)이며 원점·단위는 몸과 같습니다.
"""

import json
import math
import os
import time

import common

# MediaPipe 33점 이름(순서가 곧 번호).
MP_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right", "left_shoulder", "right_shoulder", "left_elbow",
    "right_elbow", "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index", "right_index",
    "left_thumb", "right_thumb", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
    "left_heel", "right_heel", "left_foot_index", "right_foot_index",
]

# 모델에 없는 얼굴 잔점은 가까운 점으로 채웁니다(캐릭터에는 코·귀만 씁니다).
MP_FALLBACK = {
    "left_eye_inner": "left_eye", "left_eye_outer": "left_eye", "right_eye_inner": "right_eye",
    "right_eye_outer": "right_eye", "mouth_left": "nose", "mouth_right": "nose",
    "left_eye": "nose", "right_eye": "nose",
}


def sample_times(start, end, fps):
    """앱의 `sampleTimes` 와 **같은 식** — 만분의 일 초 반올림. 둘이 다르면 키 시각이 한 장씩 어긋납니다."""
    times = []
    index = 0
    while True:
        t = round((start + index / fps) * 1e4) / 1e4
        if t > end - 1e-3:
            break
        times.append(t)
        index += 1
    return times


def video_info(path):
    import cv2

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise IOError("영상을 열지 못했습니다: {}".format(path))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    cap.release()
    return width, height, (count / native_fps) if count else 0.0, native_fps


def iter_frames(path, times):
    """영상을 **처음부터 차례로** 풀면서, 원하는 시각에 가장 가까운 장을 RGB 로 내놓습니다.

    `CAP_PROP_POS_MSEC` 로 건너뛰면 코덱(AV1·VP9)에 따라 키프레임으로만 가서 몇 장씩 어긋났습니다. 차례로 풀면 느려도
    시각이 정확합니다(분석에서 오래 걸리는 쪽은 어차피 모델입니다).
    """
    import cv2

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise IOError("영상을 열지 못했습니다: {}".format(path))
    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    wanted = list(times)
    index = 0
    frame_no = 0
    previous = None
    previous_t = -1.0
    try:
        while index < len(wanted):
            ok, frame = cap.read()
            if not ok:
                break
            msec = cap.get(cv2.CAP_PROP_POS_MSEC)
            t = msec / 1000.0 if msec > 0 else frame_no / native_fps
            frame_no += 1
            # 원하는 시각을 지나쳤으면 앞 장과 이 장 중 가까운 것을 냅니다.
            while index < len(wanted) and wanted[index] <= t:
                target = wanted[index]
                pick = frame if previous is None or abs(t - target) <= abs(previous_t - target) else previous
                yield target, cv2.cvtColor(pick, cv2.COLOR_BGR2RGB)
                index += 1
            previous = frame
            previous_t = t
        # 끝에 남은 시각은 마지막 장으로.
        while index < len(wanted) and previous is not None:
            yield wanted[index], cv2.cvtColor(previous, cv2.COLOR_BGR2RGB)
            index += 1
    finally:
        cap.release()


def look_of(image33, frame):
    """옷 색 — 앱의 `lookOf` 와 같은 식(몸통·허벅지 사각의 안쪽 60 % 평균 RGB, 0~1)."""
    height, width = frame.shape[:2]
    out = []
    for indices in ((11, 12, 23, 24), (23, 24, 25, 26)):
        xs = [image33[i][0] * width for i in indices]
        ys = [image33[i][1] * height for i in indices]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        w = max(2.0, (max(xs) - min(xs)) * 0.6)
        h = max(2.0, (max(ys) - min(ys)) * 0.6)
        x0 = int(max(0, min(width - 1, cx - w / 2)))
        x1 = int(max(x0 + 1, min(width, cx + w / 2)))
        y0 = int(max(0, min(height - 1, cy - h / 2)))
        y1 = int(max(y0 + 1, min(height, cy + h / 2)))
        patch = frame[y0:y1, x0:x1].reshape(-1, 3)
        mean = patch.mean(axis=0) / 255.0 if len(patch) else [0.0, 0.0, 0.0]
        out.extend([float(mean[0]), float(mean[1]), float(mean[2])])
    return out


def to_mediapipe(points3d, points2d, conf, width, height, unit=1.0):
    """이름 → 점 사전을 MediaPipe 33점으로.

    points3d: 이름 → (x, y, z) 카메라 좌표(OpenCV 방향), `unit` 을 곱하면 미터.
    points2d: 이름 → (픽셀 x, 픽셀 y).
    conf:     이름 → 0~1 (없으면 0.9).
    """
    def pick(table, name):
        if name in table:
            return table[name]
        fallback = MP_FALLBACK.get(name)
        while fallback and fallback not in table:
            fallback = MP_FALLBACK.get(fallback)
        return table.get(fallback) if fallback else None

    hip_l = points3d["left_hip"]
    hip_r = points3d["right_hip"]
    # numpy float32 가 섞이면 json 이 못 씁니다 — 파이썬 float 로 풀어 둡니다.
    cx = float(hip_l[0] + hip_r[0]) / 2
    cy = float(hip_l[1] + hip_r[1]) / 2
    cz = float(hip_l[2] + hip_r[2]) / 2
    image = []
    world = []
    for name in MP_NAMES:
        p3 = pick(points3d, name)
        p2 = pick(points2d, name)
        v = float(pick(conf, name) if pick(conf, name) is not None else 0.9)
        if p3 is None or p2 is None:
            p3 = (cx, cy, cz)
            p2 = points2d.get("left_hip", (0, 0))
            v = 0.0
        image.append([round(float(p2[0]) / width, 5), round(float(p2[1]) / height, 5), round(v, 3)])
        world.append([
            round((float(p3[0]) - cx) * unit, 5),
            round((float(p3[1]) - cy) * unit, 5),
            round((float(p3[2]) - cz) * unit, 5),
            round(v, 3),
        ])
    return image, world


def to_hand_landmarks(points3d, points2d, center, width, height, unit=1.0):
    """손에 없는 점을 0 으로 채우면 손가락이 골반 쪽으로 접힙니다. 잘못된 손은 생략합니다."""
    try:
        if (len(points3d) != 21 or len(points2d) != 21 or width <= 0 or height <= 0
                or not all(math.isfinite(v) for v in (width, height, unit))):
            return None
        origin = [float(center[i]) for i in range(3)]
        if not all(math.isfinite(v) for v in origin):
            return None
        image, world = [], []
        for p3, p2 in zip(points3d, points2d):
            xyz = [float(p3[i]) for i in range(3)]
            xy = [float(p2[i]) for i in range(2)]
            if not all(math.isfinite(v) for v in xyz + xy):
                return None
            # SAM 결과에는 관절별 가림 확률이 없습니다. 몸과 같은 화면 안/밖 추정값이며,
            # 화면 밖 점은 낮게 적어 프런트가 그 마디를 적용하지 않을 수 있게 합니다.
            v = 0.9 if 0 <= xy[0] < width and 0 <= xy[1] < height else 0.3
            normalized = [xy[0] / width, xy[1] / height]
            centered = [(xyz[i] - origin[i]) * unit for i in range(3)]
            if not all(math.isfinite(value) for value in normalized + centered):
                return None
            image.append([round(value, 5) for value in normalized] + [v])
            world.append([round(value, 5) for value in centered] + [v])
        return {"image": image, "world": world}
    except (IndexError, TypeError, ValueError, OverflowError):
        return None


def write_result(output, engine, width, height, duration, fps, start, end, frames):
    """결과를 쓰고 앞에 붙일 요약을 돌려줍니다. 사람 수는 «장마다 가장 많이 잡힌 수» — 이어 붙이기 전 값입니다."""
    payload = {
        "width": width,
        "height": height,
        "duration": duration,
        "fps": fps,
        "start": start,
        "end": end,
        "engine": engine,
        "frames": frames,
    }
    with open(output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"), default=float)
    most = max((len(frame["people"]) for frame in frames), default=0)
    return {"frames": len(frames), "most_people": most}


class Progress(object):
    """진행 알림을 너무 자주 보내지 않게 — 장마다 보내면 앱 쪽 이벤트가 밀립니다."""

    def __init__(self, report, total, start_percent=10, end_percent=98):
        self.report = report
        self.total = max(1, total)
        self.start = start_percent
        self.span = end_percent - start_percent
        self.last = 0.0
        self.began = time.time()

    def step(self, done, label="장"):
        now = time.time()
        if now - self.last < 0.5 and done < self.total:
            return
        self.last = now
        elapsed = now - self.began
        rate = done / elapsed if elapsed > 0 else 0
        remain = (self.total - done) / rate if rate > 0 else 0
        self.report(
            self.start + self.span * done / self.total,
            "{} / {} {} · 남은 시간 약 {}초".format(done, self.total, label, int(math.ceil(remain))),
        )


def options_of(opts):
    """앱이 넘기는 분석 옵션 — 영상 경로·구간·초당 장."""
    video = opts.get("video") or ""
    if not video or not os.path.isfile(video):
        raise IOError("영상 파일이 없습니다: {}".format(video))
    width, height, duration, native_fps = video_info(video)
    fps = float(opts.get("fps") or 30)
    start = max(0.0, float(opts.get("start") or 0))
    end = float(opts.get("end") or duration or 0)
    if duration:
        end = min(end, duration)
    if end <= start:
        raise ValueError("분석할 구간이 비었습니다({}~{}초).".format(start, end))
    common.log("영상 {}×{} · {:.2f}초 · 원래 {:.2f}fps → 초당 {}장 · {:.2f}~{:.2f}초".format(
        width, height, duration, native_fps, fps, start, end))
    return video, width, height, duration, fps, start, end
