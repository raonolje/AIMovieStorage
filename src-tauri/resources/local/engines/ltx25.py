# -*- coding: utf-8 -*-
"""LTX 2.5 — 22B 영상 DiT(Lightricks). 

미니맥스 H3 · Wan 2.2 와 나란히 놓는 **세 번째 갈래**입니다. 셋의 쓰임이 다릅니다.

  · H3   — 영상과 소리를 한 번에. 레퍼런스를 통째로 물립니다. 대신 125 GB.
  · Wan  — 로라 생태계가 가장 큼. 화풍을 고정해야 할 때.
  · LTX  — 해상도와 길이. 4K·24fps 까지 가고, fp8 로 줄이면 24 GB 카드에서도 돕니다.

# 프레임 수가 8n+1 이라야 합니다

LTX 의 VAE 는 시간축을 8배로 줍니다. 8n+1 이 아니면 마지막 토막이 잘려 끝이 뚝 끊깁니다.
길이는 사람이 **초**로 적고 여기서 맞춥니다(Wan 의 4n+1 과 같은 까닭, 배수만 다릅니다).
"""

import os
import time

import common
from ._ltx_two_stage import quality_of, resolution_plan, load_upsampler, upscale_latents, run_two_stage

_state = {"pipe": None, "mode": None, "loras": [], "plan": None, "pose": False, "repo": None,
          "quality": "single", "upsampler": None}

"""이 모델을 bf16 그대로 올리는 데 필요한 VRAM(GB) — 정밀도를 고르는 잣대."""
BF16_GB = 48.0

REPO = "Lightricks/LTX-2.5-Diffusers"


def _require_image_codec(opts):
    """첫 장면의 학습 압축을 생략하지 않고, 큰 모델을 올리기 전에 빠진 PyAV를 알립니다."""
    if not (opts.get("image") or "").strip():
        return
    import importlib.util

    if importlib.util.find_spec("av") is None:
        raise RuntimeError(
            "LTX 2.5의 첫 장면 처리에 필요한 PyAV가 없습니다. "
            "설정 → 로컬 모델 → LTX 2.5의 «다시 설치»로 환경을 갱신해 주세요."
        )


def _sampling_options(opts):
    """기본 저장소의 transformer는 distilled입니다. 일반 30단계/CFG 3을 적용하지 않습니다."""
    repo = _state.get("repo") or (os.environ.get("LTX25_REPO") or "").strip() or REPO
    if repo != REPO:
        # 예전 2.3 개발용 우회 모델까지 distilled라고 가정하지 않습니다.
        return {"num_inference_steps": int(opts.get("steps") or 30),
                "guidance_scale": float(opts.get("guidance", 3.0))}
    from diffusers.pipelines.ltx2.utils import DISTILLED_SIGMA_VALUES

    return {"sigmas": list(DISTILLED_SIGMA_VALUES), "guidance_scale": 1.0,
            "audio_guidance_scale": 1.0, "stg_scale": 0.0, "audio_stg_scale": 0.0,
            "modality_scale": 1.0, "audio_modality_scale": 1.0}


def info(root):
    return {
        "repo": REPO,
        "notes": "영상. opts.image 를 주면 그 그림에서 시작합니다(I2V). 프레임은 8n+1, 변은 32의 배수.",
    }


def _mode_of(opts):
    """어느 파이프라인이 필요한가 — 동작 기준이 있으면 InContext, 첫 장면이 있으면 I2V."""
    if (opts.get("control") or {}).get("frames") or opts.get("structure_control") is not None:
        return "pose"
    return "i2v" if (opts.get("image") or "").strip() else "t2v"


def load(root, opts):
    quality = quality_of(opts)
    if opts.get("structure_control") is not None:
        from control_policy import validate_control_options
        from structure_control import probe_structure_video
        validate_control_options("ltx25", opts, check_files=True)
        probe_structure_video(opts["structure_control"], opts)
    _require_image_codec(opts)
    mode = _mode_of(opts)
    repo = (os.environ.get("LTX25_REPO") or "").strip() or REPO
    # 정밀도를 **먼저** 셈합니다 — 이미 올라가 있어도 사람이 정밀도를 바꿨으면 다시 올려야
    # 합니다(로라만 다시 걸고 정밀도는 안 보던 자리). 판단은 `common.plan_precision` 한 곳.
    plan = common.plan_precision(BF16_GB, opts, loaded=_state["plan"])
    if quality == "two-stage" and repo != REPO:
        raise ValueError("2단계 정제는 검증된 LTX 2.5 distilled 저장소에서만 사용할 수 있습니다.")
    if (_state["pipe"] is not None and _state["mode"] == mode and _state.get("repo") == repo
            and _state.get("quality", "single") == quality and not plan["reload"]):
        _apply_loras(opts)
        return
    import diffusers

    """
    **판을 먼저 봅니다.** 2026-09-18 점검에서 이 컴퓨터의 엔진 환경에 diffusers 0.36 이
    깔려 있었습니다 — `requirements.txt` 는 0.40 을 못 박았는데 환경은 그 전에 만들어진
    것이었습니다. 0.36 에는 `LTX2*` 파이프라인이 **아예 없어서**, 그대로 두면 45 GB 를
    받고 나서 `AttributeError` 한 줄을 봅니다. 그 대신 무엇을 눌러야 하는지 말합니다.
    """
    version = tuple(int(part) for part in diffusers.__version__.split(".")[:2] if part.isdigit())
    if version < (0, 40):
        raise RuntimeError(
            "이 엔진 환경의 diffusers 가 {} 입니다 — LTX 2.5 는 0.40 이상이 필요합니다. "
            "설정 → 로컬 모델 → LTX 2.5 의 «다시 설치» 를 눌러 환경을 새로 만들어 주세요.".format(
                diffusers.__version__
            )
        )

    common.use_engine_cache(root)
    device, dtype = common.device_and_dtype()
    unload()
    # 선택했을 때만 약 1GB 부품을 읽습니다. 설정/접근 권한 문제는 본체를 올리기 전에 알립니다.
    upsampler = load_upsampler(dtype) if quality == "two-stage" else None
    """
    **`LTXPipeline` 은 LTX 1.x 것입니다.** 2.5 는 `LTX2*` 입니다 — 처음에 1.x 이름을 적어
    두었는데, diffusers 0.40 의 파이프라인 목록을 직접 열어 보고 알았습니다(2026-09-17).
    그대로 두었으면 45 GB 를 받고 나서 「그런 파이프라인이 없습니다」 를 봤을 것입니다.
    """
    """
    동작 기준(모캡 뼈 그림)이 있으면 **`LTX2InContextPipeline`** 입니다. diffusers 0.40 의
    소스를 직접 열어 보니(2026-09-18) `LTX2Pipeline`·`LTX2ImageToVideoPipeline` 은 조건
    영상을 받는 자리가 없고, IC-LoRA 용 InContext 파이프라인만 `reference_conditions`
    (참조·포즈 영상)와 `conditions`(첫 장면·키프레임)를 받습니다.
    """
    pipeline_class = getattr(
        diffusers,
        "LTX2InContextPipeline" if quality == "two-stage" else {"pose": "LTX2InContextPipeline", "i2v": "LTX2ImageToVideoPipeline"}.get(
            mode, "LTX2Pipeline"
        ),
    )
    if mode == "pose" and _pose_kwarg(pipeline_class) != "reference_conditions":
        raise RuntimeError("설치된 LTX 파이프라인에 Union 참조 입력 또는 절반 해상도 처리가 없습니다. LTX 2.5 엔진을 다시 설치해 주세요.")
    """
    `LTX25_REPO` 는 **시험용 우회로**입니다. 2.5 저장소는 게이트라 허깅페이스에서 약관에
    동의한 계정만 받을 수 있는데(2026-09-18 실측: 사용자 계정이 아직 동의 전이라 403), 그
    사이에도 같은 코드가 도는지 보려고 게이트 없는 `diffusers/LTX-2.3-Diffusers` 로 돌려
    본 길입니다. 앱은 이 변수를 주지 않으므로 평소에는 REPO 그대로입니다.
    """
    # 이 GPU 에 bf16 이 안 들어가면 **정말로 줄여서** 올립니다.
    common.log_precision(repo, plan)
    """
    `prompt_enhancer=None` — 저장소에 든 Gemma4 «프롬프트 다듬기» 모델(10 GB)은 우리가 안 씁니다
    (프롬프트는 앱이 이미 다듬어서 줍니다). 이렇게 빼 두면 diffusers 가 그 폴더를 **받지도
    올리지도** 않습니다. 2026-09-18 실측에서는 이걸 몰라 165 GB 를 받고 RAM 에까지 올렸습니다 —
    세 파이프라인(T2V·I2V·InContext) 모두 이 부품을 선택 항목으로 둡니다.
    """
    parts = {"prompt_enhancer": None, "dtype": dtype}
    try:
        if plan["bits"]:
            parts["transformer"] = common.quantized_component(repo, dtype, plan["bits"])
        pipe = pipeline_class.from_pretrained(repo, **parts)
    except Exception as error:
        """
        게이트 저장소의 403 은 «토큰이 틀렸다» 가 아니라 «약관에 동의하지 않았다» 입니다.
        허깅페이스 원문은 영어 열 줄이라 무엇을 눌러야 하는지 안 보입니다 — 주소를 바로 줍니다.
        """
        if "GatedRepoError" in type(error).__name__ or "gated" in str(error).lower():
            raise RuntimeError(
                "허깅페이스에서 {} 의 약관에 아직 동의하지 않았습니다. https://huggingface.co/{} 에 "
                "로그인해 «Agree and access repository» 를 누른 뒤(세분화 토큰이면 «Read access to "
                "public gated repos» 권한도 켜야 합니다) 다시 뽑아 주세요. 원문: {}".format(
                    repo, repo, str(error).strip().splitlines()[-1][:200]
                )
            )
        raise
    # 영상 DiT 는 그림보다 훨씬 큽니다. 오프로드 없이는 VRAM 이 넉넉해도 최고점에서 터집니다.
    pipe = common.place(pipe, device, bool(plan["bits"]))
    try:
        pipe.set_progress_bar_config(disable=True)
    except Exception:
        pass
    common.use_fast_attention(getattr(pipe, "transformer", None))
    _state["pipe"] = pipe
    _state["mode"] = mode
    _state["repo"] = repo
    _state["plan"] = plan
    _state["quality"] = quality
    _state["upsampler"] = upsampler
    _state["loras"] = []
    _apply_loras(opts)


def unload():
    _state["pipe"] = None
    _state["mode"] = None
    _state["loras"] = []
    _state["plan"] = None
    _state["pose"] = False
    _state["repo"] = None
    _state["quality"] = "single"
    _state["upsampler"] = None
    common.free_vram()


def _apply_loras(opts):
    """`opts.loras = [{"path": …, "weight": 0.8}, …]` — Wan 과 같은 규약입니다."""
    pipe = _state["pipe"]
    wanted = [item for item in (opts.get("loras") or []) if item.get("path")]
    signature = [(item["path"], float(item.get("weight", 1.0))) for item in wanted]
    if signature == _state["loras"]:
        return
    try:
        pipe.unload_lora_weights()
        # 화풍 로라를 바꾸면 포즈 로라도 함께 떨어집니다. 참조 조건만 남은 채 추론하지 않게 다음 생성에서 다시 붙입니다.
        _state["pose"] = False
    except Exception as error:
        common.log("로라를 떼지 못했습니다(무시): {}".format(error))
    rel_name = os.path.basename(wanted[0]["path"]) if wanted else ""
    names, weights = [], []
    for index, item in enumerate(wanted):
        path = item["path"]
        if not os.path.isfile(path):
            raise IOError("로라 파일을 찾지 못했습니다: {}".format(path))
        common.guard_lora_family(path)
        folder, filename = os.path.split(path)
        name = "lora{}".format(index)
        pipe.load_lora_weights(folder, weight_name=filename, adapter_name=name)
        names.append(name)
        weights.append(float(item.get("weight", 1.0)))
    if names:
        pipe.set_adapters(names, adapter_weights=weights)
        # 붙었는지 **세어 보고** 적습니다 — 안 붙어도 diffusers 는 조용합니다(`common.check_loras`).
        got = common.check_loras(getattr(pipe, "transformer", pipe), wanted, rel_name)
        common.log("로라 {}개를 먹였습니다.".format(got))
    _state["loras"] = signature


# ─────────────────────────────────────────────────────────────────────────────
# 몸 동작을 조건으로 전달 — Union IC-LoRA
# ─────────────────────────────────────────────────────────────────────────────

"""


공식 LTX 2.5 Union 워크플로는 LTX 2.3의 **22B Union IC-LoRA**를 재사용합니다.
기존 19B Pose 로라는 2.5 호환 근거가 없어 이 경로에서 사용하지 않습니다.
참조 해상도는 출력의 절반이며, 규약을 맞춰도 실제 안무 추적 정확도는 별도 실측해야 합니다.

# 규약을 **찍지 않습니다**

모델 쪽 안내가 ComfyUI 워크플로만 말하고 diffusers 호출 규약은 적어 두지 않았습니다.
그래서 여기서는 **파이프라인에게 직접 물어봅니다** — `__call__` 이 받는 인자 이름을 보고
있는 것으로 넘깁니다. 없으면 **조용히 무시하지 않고** 무엇이 없는지 말하고 멈춥니다.

조용한 무시가 가장 나쁩니다: 45 GB 를 올리고 20분을 뽑았는데 춤을 안 따라 하고, 그게
로라 탓인지 그림 탓인지 규약 탓인지 알 길이 없습니다.
"""

POSE_LORA_REPO = "Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control"
POSE_LORA_FILE = "ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors"
POSE_REFERENCE_DOWNSCALE = 2


def _pose_frames(opts, width, height, frames, output_fps=None):
    """원본 모캡의 시각으로 뼈 그림을 고릅니다. 24fps 입력을 16fps로 한 장씩 읽으면 춤이 느려집니다."""
    from PIL import Image

    control = opts.get("control") or {}
    paths = [p for p in (control.get("frames") or []) if p]
    if not paths:
        return None
    missing = [p for p in paths if not os.path.isfile(p)]
    if missing:
        raise IOError("뼈 그림을 찾지 못했습니다: {}".format(missing[0]))
    target_fps = float(output_fps or opts.get("fps") or 24)
    source_fps = float(control.get("fps") or target_fps)
    indices = [min(len(paths) - 1, int(index * source_fps / target_fps + 0.5)) for index in range(frames)]
    images = {}
    for index in set(indices):
        with Image.open(paths[index]) as image:
            images[index] = image.convert("RGB").resize((width, height))
    return [images[index] for index in indices]


def _attach_pose(pipe, opts):
    """포즈 IC-LoRA 를 얹습니다. 이미 얹혀 있으면 아무 일도 하지 않습니다."""
    if _state.get("pose"):
        return
    common.log("구조 제어용 Union IC-LoRA 를 받습니다: {}".format(POSE_LORA_REPO))
    pipe.load_lora_weights(POSE_LORA_REPO, weight_name=POSE_LORA_FILE, adapter_name="pose")
    # 이미 활성화한 화풍 로라가 있어도 pose가 빠지지 않도록 이름과 세기를 함께 지정합니다.
    styles = _state["loras"]
    pipe.set_adapters(["lora{}".format(index) for index in range(len(styles))] + ["pose"],
                      adapter_weights=[weight for _, weight in styles] + [1.0])
    _state["pose"] = True


def _pose_kwarg(pipe):
    """이 파이프라인이 조건 그림을 **어느 이름으로** 받는가. 없으면 None."""
    import inspect

    try:
        names = set(inspect.signature(pipe.__call__).parameters)
    except (TypeError, ValueError):
        return None
    """
    **`reference_conditions` 가 먼저입니다.** diffusers 0.40 의 소스를 직접 열어 보니
    (2026-09-18) 포즈 IC-LoRA 용 `LTX2InContextPipeline` 은 두 이름을 **다 가지고** 있는데
    뜻이 다릅니다 — `reference_conditions` 가 «참조 영상(포즈 영상)» 이고, `conditions` 는
    «첫 장면·키프레임 그림» 입니다. 예전 순서(`conditions` 먼저)면 뼈 그림이 첫 장면 자리로
    들어가 동작이 아니라 그림이 고정됐을 것입니다. `LTX2Pipeline`·`LTX2ImageToVideoPipeline`
    은 넷 다 없습니다 — 포즈를 쓰려면 파이프라인 자체가 InContext 여야 합니다.
    """
    return "reference_conditions" if {"reference_conditions", "reference_downscale_factor"} <= names else None


def _fit32(value):
    """변은 32의 배수라야 합니다 — 아니면 파이프라인이 제 마음대로 잘라 비율이 틀어집니다."""
    return max(32, int(round(value / 32.0)) * 32)


def _output_size(opts):
    if quality_of(opts) == "two-stage":
        plan = resolution_plan(opts.get("width") or 1280, opts.get("height") or 704, _mode_of(opts) == "pose")
        return plan["width"], plan["height"]
    # Union은 절반 크기도 VAE의 32배수여야 위치 좌표와 그림 크기가 어긋나지 않습니다.
    factor = POSE_REFERENCE_DOWNSCALE if _mode_of(opts) == "pose" else 1
    return tuple(_fit32(int(opts.get(key) or fallback) / factor) * factor
                 for key, fallback in (("width", 1280), ("height", 704)))


def generate(output, opts, report):
    quality = quality_of(opts)
    _require_image_codec(opts)
    # 마스크는 **모델을 부르기 전에** 봅니다 — 까닭은 `common.check_motion_mask`.
    common.check_motion_mask(opts)
    started = time.time()
    pipe = _state["pipe"]
    fps = int(opts.get("fps") or 24)
    seconds = float(opts.get("seconds") or 5.0)
    frames = int(round(seconds * fps))
    # 8n+1 로 올림이 아니라 내림 — 올리면 요청한 길이를 넘습니다.
    frames = max(9, ((frames - 1) // 8) * 8 + 1)
    sampling = _sampling_options(opts)
    steps = len(sampling["sigmas"]) if "sigmas" in sampling else sampling["num_inference_steps"]
    if "sigmas" in sampling:
        common.log("LTX 2.5 distilled 규약: 고정 {}단계 · CFG 1을 적용합니다.".format(steps))
    seed = common.resolve_seed(opts)
    width, height = _output_size(opts)
    two_stage = None
    if quality == "two-stage":
        if _state.get("upsampler") is None:
            raise RuntimeError("2단계 확대 부품이 준비되지 않았습니다. LTX 모델을 다시 올려 주세요.")
        two_stage = resolution_plan(width, height, _mode_of(opts) == "pose")
        common.log("LTX 2단계: {}×{} 생성 → {}×{} 최종 출력 · 8+3단계".format(
            two_stage["stage1_width"], two_stage["stage1_height"], width, height))
    stage_width = two_stage["stage1_width"] if two_stage else width
    stage_height = two_stage["stage1_height"] if two_stage else height
    if _mode_of(opts) == "pose":
        common.log("Union 참조 정렬을 위해 최종 크기를 {}의 배수 {}×{}로 맞춥니다.".format(
            128 if two_stage else 64, width, height))

    kwargs = {
        "prompt": opts.get("prompt") or "",
        "num_frames": frames,
        # 설치된 0.40 의 `__call__` 을 직접 읽어 보니(2026-09-18) 세 파이프라인 모두 `frame_rate` 를
        # 받고 기본이 24 입니다. 안 넘기면 30fps 로 뽑아도 시간 좌표·소리 길이는 24 기준이 됩니다.
        "frame_rate": float(fps),
        **sampling,
        "generator": common.generator(seed),
        "callback_on_step_end": common.step_reporter(report, steps),
    }
    negative = (opts.get("negative") or "").strip()
    if negative:
        kwargs["negative_prompt"] = negative

    kwargs["width"] = stage_width
    kwargs["height"] = stage_height
    first_frame = None
    full_first_frame = None
    image_path = (opts.get("image") or "").strip()
    if image_path:
        from PIL import Image

        if not os.path.isfile(image_path):
            raise IOError("첫 장면 그림을 찾지 못했습니다: {}".format(image_path))
        with Image.open(image_path) as image:
            full_first_frame = image.convert("RGB").resize((width, height))
            first_frame = full_first_frame.resize((stage_width, stage_height)) if two_stage else full_first_frame

    # ── 구조 기준(모캡 뼈 그림 또는 카메라까지 렌더한 영상의 윤곽) ────────
    structure_meta = None
    if opts.get("structure_control") is not None:
        from control_policy import validate_control_options
        from structure_control import canny_reference_frames
        validate_control_options("ltx25", opts, check_files=True)
        control, structure_meta = canny_reference_frames(opts["structure_control"], opts,
            stage_width, stage_height, frames, fps, POSE_REFERENCE_DOWNSCALE, report)
    else:
        control = _pose_frames(opts, stage_width, stage_height, frames, fps)
    if control:
        slot = _pose_kwarg(pipe)
        if slot != "reference_conditions":
            raise RuntimeError(
                "이 파이프라인은 참조 영상을 받지 않습니다({}). 동작을 그대로 옮기려면 "
                "LTX2InContextPipeline 이라야 합니다 — diffusers 0.40 이상인지 확인하고 "
                "설정 → 로컬 모델에서 «다시 설치» 를 눌러 주세요.".format(type(pipe).__name__)
            )
        """
        **`diffusers` 맨 위에는 이 둘이 없습니다.** 0.40 을 실제로 깔고 `from diffusers import
        LTX2ReferenceCondition` 을 해 보니 AttributeError 였습니다(2026-09-18) — 파이프라인 클래스만
        맨 위로 올라가 있고, 조건 데이터클래스는 `diffusers.pipelines.ltx2` 패키지가 냅니다.
        """
        from diffusers.pipelines.ltx2 import LTX2ReferenceCondition

        _attach_pose(pipe, opts)
        weight = float((opts.get("structure_control") or opts.get("control") or {}).get("weight", 1.0))
        """
        뼈 그림은 **참조 조건**으로, 첫 장면은 **프레임 조건**으로 — 둘의 뜻이 다릅니다.
        `reference_conditions` 는 IC-LoRA 가 «따라 할 영상» 이고, `conditions` 는 «이
        장면에서 시작하라» 입니다. 뒤바꾸면 뼈 그림이 화면에 그려집니다.
        세기(`strength`)가 조건 자체에 있어 로라 세기와 따로 겁니다.
        """
        kwargs["reference_conditions"] = [LTX2ReferenceCondition(frames=control, strength=weight)]
        kwargs["reference_downscale_factor"] = POSE_REFERENCE_DOWNSCALE
        if first_frame is not None:
            from diffusers.pipelines.ltx2 import LTX2VideoCondition

            kwargs["conditions"] = [LTX2VideoCondition(frames=first_frame, index=0)]
        common.log("동작 기준 {}장을 참조 조건으로 넘깁니다(세기 {}).".format(len(control), weight))
    elif first_frame is not None:
        # 동작 기준 없이 첫 장면만 — I2V 파이프라인은 `image` 로 받습니다.
        if two_stage:
            from diffusers.pipelines.ltx2 import LTX2VideoCondition
            kwargs["conditions"] = [LTX2VideoCondition(frames=first_frame, index=0)]
        else:
            kwargs["image"] = first_frame

    if two_stage:
        from diffusers.pipelines.ltx2 import LTX2VideoCondition
        final_conditions = [LTX2VideoCondition(frames=full_first_frame, index=0)] if full_first_frame is not None else None
        pipe.vae.enable_tiling()
        result = run_two_stage(pipe, kwargs, two_stage,
            lambda latents: upscale_latents(_state["upsampler"], latents),
            lambda count, base, span: common.step_reporter(report, count, base, span),
            lambda call: common.run_attention_safe(pipe, call), final_conditions)
    else:
        result = common.run_attention_safe(pipe, lambda: pipe(**kwargs))
    report(95, "mp4 로 내보내는 중")
    # 「여기만 움직인다」 흑백 마스크가 왔으면 검은 곳을 첫 장면에 묶습니다(`common.freeze_by_mask`).
    frames_out = common.freeze_by_mask(result.frames[0], opts.get("motion_mask"))
    common.save_video(frames_out, output, fps)
    out = {
        "width": width,
        "height": height,
        "frames": frames,
        "fps": fps,
        "seconds_video": round(frames / float(fps), 2),
        "seed": seed,
        "generate_seconds": round(time.time() - started, 2),
        "inference_steps": steps,
        "guidance_scale": sampling["guidance_scale"],
        "ltx_quality": quality,
    }
    # 요청한 정밀도와 실제로 올라간 정밀도 — 한 곳에서 만듭니다.
    out.update(common.precision_fields(_state["plan"]))
    if structure_meta is not None:
        out["structure_control"] = structure_meta
    if two_stage:
        out["two_stage"] = dict(two_stage, stage1_steps=steps, stage2_steps=3,
            requested_width=int(opts.get("width") or 1280), requested_height=int(opts.get("height") or 704),
            adapters="stage1-only", reference_conditions="stage1-only", spatial_scale=2)
        out["inference_steps"] = steps + 3
    return out
