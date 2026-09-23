# -*- coding: utf-8 -*-
"""SAM 손 번호·축·직렬화 계약을 검사합니다. 추론과 영상 해독은 모의 객체로 막습니다.

번호의 근거는 설치 manifest 가 고정한 b5c765a 의 공식 metadata/mhr70.py 입니다.
https://github.com/facebookresearch/sam-3d-body/blob/b5c765a0d89d789985e186d396315e7590887b94/sam_3d_body/metadata/mhr70.py
"""
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from engines import _mocap, sam3dbody


def person_fixture():
    return {
        "pred_keypoints_3d": np.array([[i * 0.01, i * 0.02, i * 0.03] for i in range(70)]),
        "pred_keypoints_2d": np.array([[100.0 + i, 100.0 + i] for i in range(70)]),
    }


class MocapHandTests(unittest.TestCase):
    def test_mhr_fingers_are_base_to_tip_and_side_is_preserved(self):
        person = person_fixture()
        result = sam3dbody._landmarks_of(person, 640, 480)
        for side, body_wrist, bases, tips in (
            ("right", 16, (24, 28, 32, 36, 40), (21, 25, 29, 33, 37)),
            ("left", 15, (45, 49, 53, 57, 61), (42, 46, 50, 54, 58)),
        ):
            hand = result["hands"][side]
            self.assertEqual(len(hand["image"]), 21)
            self.assertEqual(len(hand["world"]), 21)
            self.assertEqual(hand["image"][0], result["image"][body_wrist])
            self.assertEqual(hand["world"][0], result["world"][body_wrist])
            for finger, (base, tip) in enumerate(zip(bases, tips)):
                self.assertEqual(hand["image"][1 + finger * 4][0], round((100 + base) / 640, 5))
                self.assertEqual(hand["image"][4 + finger * 4][0], round((100 + tip) / 640, 5))
                # 원점은 손목이 아니라 몸과 같은 골반 가운데(9·10번의 중점)입니다.
                self.assertAlmostEqual(hand["world"][4 + finger * 4][0], tip * 0.01 - 0.095, places=5)

    def test_body_axis_correction_is_also_applied_to_hands(self):
        normal = person_fixture()
        flipped = person_fixture()
        flipped["pred_keypoints_3d"] *= [1, -1, -1]
        self.assertEqual(sam3dbody._landmarks_of(normal, 640, 480), sam3dbody._landmarks_of(flipped, 640, 480))

    def test_invalid_finger_omits_only_that_hand_and_never_writes_nan(self):
        for invalid in (float("nan"), float("inf")):
            for key in ("pred_keypoints_3d", "pred_keypoints_2d"):
                with self.subTest(invalid=invalid, key=key):
                    person = person_fixture()
                    person[key][21, 0] = invalid
                    result = sam3dbody._landmarks_of(person, 640, 480)
                    self.assertNotIn("right", result["hands"])
                    self.assertIn("left", result["hands"])
                    self.assertEqual(len(result["world"]), 33)
                    json.dumps(result, allow_nan=False)

    def test_outside_image_finger_is_low_confidence_not_invented_at_origin(self):
        person = person_fixture()
        person["pred_keypoints_2d"][21, 0] = -12
        result = sam3dbody._landmarks_of(person, 640, 480)
        tip = result["hands"]["right"]["image"][4]
        self.assertLess(tip[0], 0)
        self.assertEqual(tip[2], 0.3)
        self.assertEqual(result["hands"]["right"]["world"][4][3], 0.3)

    def test_bad_origin_or_incomplete_model_result_is_skipped(self):
        person = person_fixture()
        person["pred_keypoints_3d"][9, 0] = float("nan")
        self.assertIsNone(sam3dbody._landmarks_of(person, 640, 480))
        self.assertIsNone(sam3dbody._landmarks_of({}, 640, 480))
        person = person_fixture()
        person["pred_keypoints_2d"] = person["pred_keypoints_2d"][:20]
        self.assertIsNone(sam3dbody._landmarks_of(person, 640, 480))

    def test_real_generate_selects_full_or_body_and_serializes_optional_hands(self):
        class Estimator:
            def process_one_image(self, rgb, bboxes, inference_type):
                self.inference_type = inference_type
                return [person_fixture()]

        with tempfile.TemporaryDirectory() as folder:
            for opts, expected_mode in (({}, "full"), ({"hands": False}, "body")):
                estimator = Estimator()
                path = str(pathlib.Path(folder) / (expected_mode + ".json"))
                with patch.dict(sam3dbody._state, {"estimator": estimator}), \
                     patch.object(_mocap, "options_of", return_value=("unused.mp4", 640, 480, 1, 1, 0, 1)), \
                     patch.object(_mocap, "iter_frames", return_value=iter([(0, np.zeros((480, 640, 3), dtype=np.uint8))])), \
                     patch.object(sam3dbody, "_people_boxes", return_value=[([0, 0, 640, 480], 0.95)]):
                    summary = sam3dbody.generate(path, opts, lambda *_: None)
                payload = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
                person = payload["frames"][0]["people"][0]
                self.assertEqual(estimator.inference_type, expected_mode)
                self.assertEqual(summary["most_people"], 1)
                self.assertEqual("hands" in person, expected_mode == "full")
                self.assertEqual(len(person["world"]), 33)
                if expected_mode == "full":
                    self.assertEqual(len(person["hands"]["left"]["world"]), 21)

    def test_old_engine_payload_without_hands_is_unchanged(self):
        frames = [{"t": 0, "people": [{"image": [], "world": [], "score": 0.9, "look": []}]}]
        with tempfile.TemporaryDirectory() as folder:
            path = str(pathlib.Path(folder) / "old.json")
            _mocap.write_result(path, "old-engine", 640, 480, 1, 1, 0, 1, frames)
            payload = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
        self.assertEqual(payload["frames"], frames)


if __name__ == "__main__":
    unittest.main()
