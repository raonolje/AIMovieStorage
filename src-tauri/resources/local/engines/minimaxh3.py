# -*- coding: utf-8 -*-
"""MiniMax-H3 — 영상과 **사운드트랙을 함께** 뽑습니다. 오픈 웨이트(2026-08-03).

/ 「미니맥스 컴피UI에서 로컬로 돌아가는데..?」.

컴피UI 를 거치지 않고 **diffusers 로 우리가 직접** 돌립니다.

# 워크플로 셋 — 우리 컷 흐름과 그대로 맞습니다

    t2va   글만. 구도도 그림도 없을 때.
    fl2va  첫 프레임(과 끝 프레임). 컷 대표 그림에서 시작할 때.
    ref2va 레퍼런스 여럿(그림 9·영상 3·소리 3). **구도잡기 레퍼런스 영상 + 인물 시트 +
           배경**을 통째로 물리는 길입니다 — 사용자가 컷 영상에서 바라던 바로 그것.

`transformer/`(t2va·fl2va)와 `transformer_ref/`(ref2va)가 **다른 덩어리**라, 워크플로가
바뀌면 다시 올립니다. 61.7 GB 짜리라 비싸지만, 둘 다 올려 두면 호스트 RAM 이 먼저 터집니다.

# 가중치는 설치 때 통째로 미리 받습니다(`prefetch`)

 그전에는 첫 생성 때 받았는데, 그러면 `load` 가 그때의
워크플로 것만 받습니다 — 사용자의 기계에 `transformer/`·`text_encoder/` 는 있고 `transformer_ref/`
는 **없었습니다.** 레퍼런스 영상을 처음 뽑는 날 «생성 중» 안에서 62 GB 를 말없이 받게 되는
구조라, 설치 때(이미 깔린 엔진은 «가중치 미리 받기» 단추로) 저장소를 통째로 받아 둡니다.

# 이 모델의 규칙 — 어기면 조용히 이상해집니다

- **guidance 증류판**입니다. 네거티브 프롬프트도 guidance_scale 도 없습니다(넣으면 오류).
- **24 fps 고정**, 5~15초. 프레임 수는 `17n+5` 로 올려 맞춥니다 — VAE 가 시간축을 그렇게
  나눠서, 안 맞으면 디코드가 안 됩니다. 그래서 **5초보다 짧은 컷도 5.17초**가 됩니다.
- 가로·세로는 **32의 배수**, 짧은 변 768 이 학습 canvas 입니다. 960×544 는 1344×768 보다
  스텝당 2.3배 빠릅니다 — 시험 삼아 뽑을 때 크게 잡지 마세요.
- 영상과 소리가 **따로 나옵니다**. 한 파일로 합치는 것은 부르는 쪽 몫입니다(`encode_video`).
"""

import os
import time

import common
from engines._h3_lora_contract import generation_contract, lora_load_kwargs, require_reference_resize_support

_state = {"pipe": None, "manager": None, "workflow": None, "loras": [], "plan": None,
          "scheduler_shifts": None}

#: 24 fps · 5~15초. `17n+5` 로 스냅한 뒤의 실제 범위입니다(n=7 → 124, n=20 → 345).
MIN_FRAMES = 124
MAX_FRAMES = 345
FPS = 24


REPO = "MiniMaxAI/MiniMax-H3"

"""
bf16 그대로 올릴 때의 크기(GB) — 트랜스포머 61.7 + 조건화기 62.1.

**여기 적는 값은 «모델 크기» 이지 «필요한 VRAM» 이 아닙니다.** 중간값·인코더 몫은
`common.plan_precision` 이 `PRECISION_HEADROOM`(1.25배)으로 따로 얹습니다 — 그래서
bf16 으로 가는 문턱은 155 GB 이고, 지금 나와 있는 어떤 카드로도 bf16 은 못 올립니다.
사실상 늘 int8 인데 그게 맞습니다 — 도는 것이 안 도는 것보다 낫습니다.

여태 이 엔진만 `vram < 155` 를 손으로 들고 있었습니다. 같은 규칙이 두 벌이면 한쪽만
고치는 날이 옵니다(그때 잘못된 40 을 오래 들고 있었고, 96 GB 카드에서도 bf16 을 골랐습니다).
"""
BF16_GB = 124.0

"""
**이 엔진이 실제로 올릴 수 있는 정밀도.** int4 길은 없습니다 — 여기 양자화는 torchao
int8(version=2)이라야 텐서가 pin 되고, pin 이 돼야 블록 스트리밍 오프로드가 됩니다.
작은 카드에서 규칙이 int4 를 고르면 `plan_precision` 이 int8 로 내려 잡습니다.
"""
SUPPORTED = ("bf16", "int8")


def info(root):
    return {
        "repo": REPO,
        "notes": "영상+사운드트랙을 한 번에. 24fps 5~15초. 네거티브·guidance 없음(증류판).",
    }


def prefetch(root, report):
    """저장소를 **통째로** 미리 받습니다 — `transformer_ref/`(ref2va, 62 GB)까지.

    워크플로마다 골라 받으면 «구도잡기 레퍼런스 영상 + 인물 시트» 를 처음 물리는 날 생성 안에서
    또 받습니다. 그래서 가리지 않고 다 받습니다(약 190 GB). 이미 있는 파일은 건너뜁니다.
    """
    from engines import _hf  # 워커가 `engines.<id>` 로 불러오므로 helper 도 같은 꾸러미에서

    common.use_engine_cache(root)
    report(None, "{} 파일 목록을 읽는 중".format(REPO))
    _hf.snapshot(REPO, report)


def _snap_frames(seconds):
    """초 → `17n+5` 프레임. 모자라면 올리고, 넘치면 자릅니다."""
    wanted = int(round(float(seconds) * FPS))
    n = max(0, -(-(wanted - 5) // 17))  # 올림 나눗셈
    frames = 17 * n + 5
    return max(MIN_FRAMES, min(MAX_FRAMES, frames))


def _pick_workflow(opts):
    if opts.get("references"):
        return "ref2va"
    if (opts.get("image") or "").strip() or (opts.get("last_image") or "").strip():
        return "fl2va"
    return "t2va"


def _place_resident_rotary_buffer(transformer, device):
    # device_map은 체크포인트에 없는 RoPE inv_freq(persistent=False)를
    # CPU에 남길 수 있습니다. 상주 transformer와 같은 장치로 옮기되
    # float32 주파수의 정밀도와 양자화한 가중치는 바꾸지 않습니다.
    transformer.rope.to(device=device)


def _transformer_name(workflow):
    # Ref2VA는 파일 폴더뿐 아니라 실행 부품 이름도 다릅니다. transformer에 넣으면
    # load_components가 별도 transformer_ref를 다시 받아 정밀도·장치·로라 설정을 잃습니다.
    return "transformer_ref" if workflow == "ref2va" else "transformer"


def _active_transformer(pipe, workflow):
    return getattr(pipe, _transformer_name(workflow))


def _configure_reference_processor(pipe, workflow):
    # Qwen3-VL 5.17의 기본값은 짧은 영상에도 전체 픽셀 예산을 써 버립니다.
    # 공식 qwen-vl-utils와 같은 프레임당 토큰 상한을 켭니다. 프레임 수·시각은 유지합니다.
    if workflow == "ref2va":
        pipe.processor.video_processor.cap_pixels_per_frame = True


def load(root, opts):
    workflow = _pick_workflow(opts)
    # 프리셋/파일/워크플로가 맞지 않으면 큰 모델을 올리기 전에 거절합니다.
    generation_contract(opts, workflow)
    # 정밀도를 **먼저** 셈합니다 — 이미 올라가 있어도 사람이 정밀도를 바꿨으면 다시 올려야
    # 합니다(로라만 다시 걸고 정밀도는 안 보던 자리). 판단은 `common.plan_precision` 한 곳.
    plan = common.plan_precision(BF16_GB, opts, loaded=_state["plan"], supported=SUPPORTED)
    if _state["pipe"] is not None and _state["workflow"] == workflow and not plan["reload"]:
        _apply_loras(opts)
        return

    import torch
    from diffusers import ComponentsManager, ModularPipeline

    common.use_engine_cache(root)
    unload()

    manager = ComponentsManager()
    if workflow == "ref2va":
        from engines._h3_reference_resize import reference_pipeline
        pipe = reference_pipeline(REPO, manager)
    else:
        pipe = ModularPipeline.from_pretrained(REPO, components_manager=manager)

    vram = plan["vram"]
    common.log("MiniMax-H3 {} 워크플로를 올립니다.".format(workflow))
    common.log_precision(REPO, plan)

    if plan["bits"]:
        """
        **int8 로 양자화해서** 올립니다.

        bf16 그대로는 트랜스포머 61.7 GB + 조건화기 62.1 GB 라 소비자 카드에 안 들어갑니다.
        허깅페이스가 권하는 그대로 int8(version=2) + 블록 단위 스트리밍 오프로드를 씁니다 —
        version 2 텐서라야 pin 이 되고, pin 이 돼야 스트리밍 오프로드가 됩니다.
        `requires_grad_(False)` 는 양자화 텐서가 못 여는 autograd 경로 하나를 닫는 것입니다.
        """
        from diffusers import MiniMaxH3Transformer3DModel, TorchAoConfig
        from diffusers.hooks import apply_group_offloading
        from transformers import Qwen3VLForConditionalGeneration
        from transformers import TorchAoConfig as TransformersTorchAoConfig
        from torchao.quantization import Int8WeightOnlyConfig

        subfolder = _transformer_name(workflow)
        """
        **큰 카드는 처음부터 GPU 로 흘려 넣습니다.**

        2026-09-18 실측: 96 GB 카드에서 양자화 부품을 CPU 에 다 만든 뒤 옮기려 했더니,
        조각 8/14 에서 워커가 **말없이 죽었습니다**(시스템 RAM 여유 36 GB). 트랜스포머
        31 GB + 조건화기 31 GB 가 램에 함께 앉고 그 위로 읽는 버퍼까지 겹치기 때문입니다.

        `device_map` 을 주면 조각을 읽는 족족 GPU 로 보내고 CPU 는 비웁니다 — 램이 아니라
        VRAM 을 씁니다. 작은 카드에는 못 쓰는 길이라(그쪽은 오프로드가 유일합니다) 큰
        카드에서만 켭니다.
        """
        big = vram >= 80
        """
        **조건화기는 큰 카드에서도 GPU 에 붙박아 두지 않습니다.**

        2026-09-22 실측(96 GB 카드): 트랜스포머 31 GB + 조건화기 31 GB 를 통째로 올리니 활성값에
        34 GB 만 남았고, 124프레임 960×544 영상이 그 안에 안 들어가 `CUDA error: unknown error` 로
        죽었습니다(로그에 torchao int8 오류가 다섯 번 뒤 컨텍스트가 깨짐).

        조건화기는 **맨 앞에서 한 번** 프롬프트를 읽고 끝입니다. 흘려 보내도 전체 시간에 거의
        영향이 없고, 대신 31 GB 가 통째로 활성값 몫으로 돌아옵니다. 매 스텝 도는 트랜스포머만
        `device_map` 으로 GPU 에 바로 실어 로딩 때 램이 부풀지 않게 합니다.
        """
        place = {"device_map": "cuda"} if big else {}
        components = {
            subfolder: MiniMaxH3Transformer3DModel.from_pretrained(
                REPO,
                subfolder=subfolder,
                dtype=torch.bfloat16,
                quantization_config=TorchAoConfig(
                    Int8WeightOnlyConfig(version=2),
                    modules_to_not_convert=[
                        "proj_in", "audio_proj_in", "context_embedder", "time_embedder",
                        "time_proj", "token_refiner", "norm_out", "proj_out", "audio_proj_out",
                    ],
                ),
                # 양자화할 때는 `low_cpu_mem_usage` 를 끄면 안 됩니다. 2026-09-18 실측:
                # 「cannot be False or None when using quantization」 으로 바로 죽었습니다.
                # 양자화는 층을 하나씩 올리며 바꾸는 길이라 그 켜짐이 전제입니다.
                # 예전에는 이 줄이 숨어 있었습니다 — 양자화는 VRAM 40 GB 미만에서만 돌았고,
                # 그런 카드로는 애초에 여기까지 오지도 못했으니까요.
                **place,
            ),
            "text_encoder": Qwen3VLForConditionalGeneration.from_pretrained(
                REPO,
                subfolder="text_encoder",
                dtype=torch.bfloat16,
                quantization_config=TransformersTorchAoConfig(
                    Int8WeightOnlyConfig(version=2),
                    modules_to_not_convert=[
                        "model.visual",
                        "model.language_model.embed_tokens",
                        "model.language_model.norm",
                        "lm_head",
                    ],
                ),
                **({} if big else place),
            ),
        }
        pipe.update_components(**components)
        pipe.load_components(workflow=workflow, dtype=torch.bfloat16)
        transformer = _active_transformer(pipe, workflow)
        transformer.requires_grad_(False)
        pipe.text_encoder.requires_grad_(False)

        """
        **VRAM 이 넉넉하면 CPU 를 거치지 않습니다.**

        2026-09-18 실측: 96 GB 카드에서 int8 로 올렸는데도 **시스템 RAM 을 99 GB** 물고
        기계가 멎기 직전까지 갔습니다(여유 1.7 GB). 까닭은 오프로드입니다 — 블록 단위
        스트리밍은 «가중치는 CPU 에 두고 쓸 때만 GPU 로 올리는» 방식이라, CPU 쪽 사본이
        내내 남아 있습니다. 작은 카드에는 그것이 유일한 길이지만 큰 카드에는 손해입니다.

        int8 이면 트랜스포머·조건화기가 각각 31 GB 쯤이라 합쳐 64 GB 입니다. 80 GB 넘는
        카드면 통째로 VRAM 에 올리고 CPU 는 비웁니다 — 램도 살고 블록을 실어 나르지
        않으니 더 빠릅니다.
        """
        if big:
            # 트랜스포머는 `device_map` 으로 이미 GPU 에 있습니다. 조건화기만 흘려 보냅니다.
            _place_resident_rotary_buffer(transformer, torch.device("cuda"))
            apply_group_offloading(
                pipe.text_encoder.model,
                offload_type="leaf_level",
                onload_device=torch.device("cuda"),
                offload_device=torch.device("cpu"),
                use_stream=True,
            )
            common.log("트랜스포머는 GPU 에 붙박고 조건화기는 흘려 보냅니다 — 활성값에 31 GB 를 더 남깁니다.")
        else:
            offload = dict(
                onload_device=torch.device("cuda"),
                offload_device=torch.device("cpu"),
                use_stream=vram >= 20,
            )
            transformer.enable_group_offload(
                offload_type="block_level", num_blocks_per_group=1, **offload
            )
            apply_group_offloading(pipe.text_encoder.model, offload_type="leaf_level", **offload)
        pipe.vae.to("cuda")
        pipe.audio_vae.to("cuda")
        # CPU 에 남은 사본을 놓아 줍니다 — 안 그러면 램이 그대로 묶여 있습니다.
        common.free_vram()
    else:
        # 넉넉한 카드는 통째로 bf16. 관리자가 블록마다 올렸다 내렸다 합니다.
        pipe.load_components(workflow=workflow, dtype=torch.bfloat16)
        manager.enable_auto_cpu_offload(device="cuda", memory_reserve_margin="12GB")

    _configure_reference_processor(pipe, workflow)
    # 어텐션을 빠른 것으로 — 되는 것이 없으면 기본값 그대로 갑니다.
    common.use_fast_attention(_active_transformer(pipe, workflow))
    _state["pipe"] = pipe
    _state["manager"] = manager
    _state["workflow"] = workflow
    _state["plan"] = plan
    _state["scheduler_shifts"] = (pipe.scheduler.shift, pipe.audio_scheduler.shift)
    _state["loras"] = []
    _apply_loras(opts)


def unload():
    _state["pipe"] = None
    _state["manager"] = None
    _state["workflow"] = None
    _state["loras"] = []
    _state["plan"] = None
    _state["scheduler_shifts"] = None
    common.free_vram()


def _apply_loras(opts):
    """`opts.loras = [{"path": …, "weight": 0.8}, …]` — 여러 개를 한꺼번에(멀티 로라)."""
    pipe = _state["pipe"]
    transformer = _active_transformer(pipe, _state["workflow"])
    wanted = [item for item in (opts.get("loras") or []) if item.get("path")]
    signature = [(item["path"], float(item.get("weight", 1.0))) for item in wanted]
    if signature == _state["loras"]:
        return

    for method in ("unload_lora", "unload_lora_weights", "disable_lora"):
        if hasattr(transformer, method):
            try:
                getattr(transformer, method)()
                break
            except Exception as error:
                common.log("로라를 떼지 못했습니다(무시): {}".format(error))

    names, weights = [], []
    for index, item in enumerate(wanted):
        path = item["path"]
        if not os.path.isfile(path):
            raise IOError("로라 파일을 찾지 못했습니다: {}".format(path))
        common.guard_lora_family(path)
        state_dict, hit = common.prepare_lora(transformer, path)
        if not hit:
            raise common.lora_mismatch(transformer, state_dict, path)
        name = "lora{}".format(index)
        transformer.load_lora_adapter(
            state_dict,
            prefix=None,
            adapter_name=name,
            # prefix=None에서는 network_alphas 대신 PEFT metadata로 파일의 알파를
            # 보존합니다. 알파가 없는 일반 로라의 기존 추론/사용자 세기는 유지합니다.
            **lora_load_kwargs(path, state_dict),
        )
        common.log("로라 «{}» — 맞는 자리 {}곳.".format(os.path.basename(path), hit))
        names.append(name)
        weights.append(float(item.get("weight", 1.0)))
    if names:
        try:
            transformer.set_adapters(names, weights)
            got = common.check_loras(transformer, wanted, os.path.basename(wanted[0]["path"]))
            common.log("로라 {}개를 먹였습니다.".format(got))
        except Exception as error:
            # 겹쳐 켜기가 안 되는 판이면 마지막 것만 살아 있습니다 — 조용히 넘기지 않습니다.
            common.log("로라를 겹쳐 켜지 못했습니다(마지막 것만 듣습니다): {}".format(error))
    _state["loras"] = signature


def _configure_generation(pipe, contract, steps):
    """프리셋을 끈 재사용 요청에도 원래 스케줄러를 복원합니다."""
    baseline = _state["scheduler_shifts"]
    if baseline is None:
        baseline = (pipe.scheduler.shift, pipe.audio_scheduler.shift)
        _state["scheduler_shifts"] = baseline
    video_shift = contract.get("video_shift", baseline[0])
    audio_shift = contract.get("audio_shift", baseline[1])
    pipe.scheduler.set_shift(video_shift)
    pipe.audio_scheduler.set_shift(audio_shift)
    if _state["workflow"] == "ref2va":
        require_reference_resize_support(contract, [item.name for item in pipe.blocks.inputs])
    return contract.get("num_inference_steps", steps)


def _references(opts, generated_frames):
    """`opts.references = [{"kind": "image"|"video"|"audio", "path": …}, …]` → 레퍼런스 객체.

    **순서가 뜻입니다.** 모델이 프롬프트에 「<Picture 1>」 처럼 이름을 붙이고 공유 시계에
    올려 두기 때문에, 같은 것을 다른 순서로 주면 다른 요청입니다.
    파일을 여는 것은 부르는 쪽 몫이라 `from_file` 을 씁니다 — 그래야 영상의 실제 fps 와
    소리의 표본율이 함께 실립니다(`load_video` 는 fps 를 잃어버립니다).
    """
    from diffusers.modular_pipelines.minimax_h3 import (
        MiniMaxH3AudioReference,
        MiniMaxH3ImageReference,
        MiniMaxH3VideoReference,
    )

    table = {
        "image": MiniMaxH3ImageReference,
        "video": MiniMaxH3VideoReference,
        "audio": MiniMaxH3AudioReference,
    }
    from engines._h3_reference import load_video_reference

    out, video_metadata = [], []
    for item in opts.get("references") or []:
        path = (item.get("path") or "").strip()
        kind = item.get("kind") or "image"
        if not path:
            continue
        if not os.path.isfile(path):
            raise IOError("레퍼런스를 찾지 못했습니다: {}".format(path))
        if kind == "video":
            reference, metadata = load_video_reference(
                path, opts.get("reference_video_range"), table[kind], generated_frames, FPS
            )
            metadata["reference_index"] = len(out)
            video_metadata.append(metadata)
            out.append(reference)
        else:
            out.append(table[kind].from_file(path))
    return out, video_metadata


def generate(output, opts, report):
    import torch
    from diffusers.utils.export_utils import encode_video

    # 마스크는 **모델을 부르기 전에** 봅니다 — 까닭은 `common.check_motion_mask`.
    common.check_motion_mask(opts)
    started = time.time()
    pipe = _state["pipe"]
    workflow = _state["workflow"]
    contract = generation_contract(opts, workflow)
    frames = _snap_frames(opts.get("seconds") or 5.0)
    steps = _configure_generation(pipe, contract, int(opts.get("steps") or 30))
    seed = common.resolve_seed(opts)

    kwargs = {
        "prompt": opts.get("prompt") or "",
        "num_frames": frames,
        "num_inference_steps": steps,
        "generator": torch.Generator().manual_seed(seed),
        "output": ["videos", "audio", "sampling_rate"],
    }
    # 32의 배수라야 합니다. 안 주면 모델이 첫 키프레임 비율로 제 canvas 를 고릅니다.
    width = opts.get("width")
    height = opts.get("height")
    if width and height:
        kwargs["width"] = int(width) // 32 * 32
        kwargs["height"] = int(height) // 32 * 32

    video_metadata = []
    if workflow == "ref2va":
        kwargs["reference_resize_mode"] = contract["reference_resize_mode"]
        kwargs["references"], video_metadata = _references(opts, frames)
        for reference in video_metadata:
            report(9, "영상 레퍼런스 {} · 입력 {:.2f}초 · H3 조건 {:.2f}초".format(
                "앞 5초" if reference["range"] == "first5s" else "전체",
                reference["decoded_seconds"], reference["conditioning_seconds"],
            ))
    elif workflow == "fl2va":
        from diffusers.utils import load_image

        first = (opts.get("image") or "").strip()
        last = (opts.get("last_image") or "").strip()
        if first:
            kwargs["image"] = load_image(first)
        if last:
            kwargs["last_image"] = load_image(last)

    report(10, "{:.1f}초 · {}프레임 · {}".format(frames / FPS, frames, workflow))
    results = common.run_attention_safe(pipe, lambda: pipe(**kwargs))

    report(95, "영상과 소리를 한 파일로 합치는 중")
    # 소리는 따로 나옵니다. 여기서 합치지 않으면 **소리 없는 mp4** 가 남습니다.
    # 「여기만 움직인다」 흑백 마스크가 왔으면 검은 곳을 첫 장면에 묶습니다(`common.freeze_by_mask`).
    video_out = common.freeze_by_mask(results["videos"][0], opts.get("motion_mask"))
    encode_video(
        video_out,
        fps=FPS,
        output_path=output,
        audio=results["audio"][0],
        audio_sample_rate=results["sampling_rate"],
    )
    out = {
        "frames": frames,
        "fps": FPS,
        "seconds_video": round(frames / float(FPS), 2),
        "workflow": workflow,
        "transformer_component": _transformer_name(workflow),
        "seed": seed,
        "has_audio": True,
        "generate_seconds": round(time.time() - started, 2),
        "reference_videos": video_metadata,
        "reference_video_token_cap": pipe.processor.video_processor.max_video_tokens if workflow == "ref2va" else None,
        "h3_lora_preset": contract["id"],
        "reference_resize_mode": contract["reference_resize_mode"] if workflow == "ref2va" else None,
        "scheduler_grid_points": steps,
        "model_evaluations": len(pipe.scheduler.timesteps),
        "video_shift": pipe.scheduler.shift,
        "audio_shift": pipe.audio_scheduler.shift,
    }
    # 요청한 정밀도와 실제로 올라간 정밀도 — 한 곳에서 만듭니다.
    out.update(common.precision_fields(_state["plan"]))
    return out
