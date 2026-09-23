# -*- coding: utf-8 -*-
"""공식 IC-LoRA의 두 단계 계약: 참조는 첫 단계에만, 정제는 같은 distilled 본체로."""

UPSAMPLER_REPO = "Lightricks/LTX-2.5-Diffusers"
UPSAMPLER_REVISION = "426936f8b22dc28e4def61e515478b0b7e4a53cc"


def quality_of(opts):
    quality = opts.get("ltx_quality", "single")
    if quality not in ("single", "two-stage"):
        raise ValueError("LTX 품질은 single 또는 two-stage여야 합니다.")
    return quality


def resolution_plan(width, height, controlled=False):
    # 최종 변 → 1단계 절반 → Union 참조 절반. 각 VAE 입력은 32의 배수여야 합니다.
    multiple = 128 if controlled else 64
    final = tuple(max(multiple, int(round(int(value) / multiple)) * multiple) for value in (width, height))
    return {"width": final[0], "height": final[1], "stage1_width": final[0] // 2,
            "stage1_height": final[1] // 2, "alignment": multiple}


def load_upsampler(dtype):
    from diffusers.pipelines.ltx2.latent_upsampler import LTX2LatentUpsamplerModel
    # 본체 캐시를 재사용하되 저장소가 바뀌어 다른 구조의 부품을 받지 않도록 고정합니다.
    # 인증은 워커의 기존 HF 환경을 그대로 사용하며 별도로 토큰을 읽지 않습니다.
    return LTX2LatentUpsamplerModel.from_pretrained(UPSAMPLER_REPO, subfolder="latent_upsampler",
        revision=UPSAMPLER_REVISION, dtype=dtype)


def upscale_latents(model, latents):
    import torch
    # stage1 latent는 이미 역정규화되어 있습니다. 공유 VAE에 새 offload hook을 달거나
    # 두 번 역정규화하지 않고, 공식 LatentUpsamplePipeline의 기본 경로를 그대로 적용합니다.
    device = latents.device
    try:
        model.to(device)
        with torch.no_grad():
            return model(latents.to(device=device, dtype=model.dtype))
    finally:
        model.to("cpu")


def run_two_stage(pipe, kwargs, plan, upscale, step_reporter, run, stage2_conditions=None):
    from diffusers import FlowMatchEulerDiscreteScheduler
    from diffusers.pipelines.ltx2.utils import STAGE_2_DISTILLED_SIGMA_VALUES
    sigmas = list(STAGE_2_DISTILLED_SIGMA_VALUES)
    if sigmas != [0.909375, 0.725, 0.421875]:
        raise RuntimeError("설치된 LTX 정제 시그마가 검증한 2.5 규약과 다릅니다.")
    original_scheduler = pipe.scheduler
    # API를 먼저 검사해 1단계가 끝난 뒤 LoRA를 끌 수 없다는 오류가 나지 않게 합니다.
    has_adapters = bool(getattr(pipe.transformer, "peft_config", {}))
    if has_adapters and not all(callable(getattr(pipe, name, None)) for name in ("disable_lora", "enable_lora")):
        raise RuntimeError("이 LTX 파이프라인은 정제 단계에서 로라를 안전하게 분리할 수 없습니다.")
    first = dict(kwargs, output_type="latent", return_dict=False,
        callback_on_step_end=step_reporter(len(kwargs["sigmas"]), 10, 55))
    # 고정 distilled 시그마가 scheduler의 동적 shift를 다시 거치지 않게 합니다.
    pipe.scheduler = FlowMatchEulerDiscreteScheduler.from_config(original_scheduler.config,
        use_dynamic_shifting=False, shift_terminal=None, shift=1.0)
    adapters_disabled = False
    try:
        video_latents, audio_latents = run(lambda: pipe(**first))
        upscaled = upscale(video_latents)
        if has_adapters:
            adapters_disabled = True
            pipe.disable_lora()
        second = dict(kwargs)
        for key in ("reference_conditions", "reference_downscale_factor", "conditioning_attention_strength",
                    "conditioning_attention_mask", "conditions", "image", "num_inference_steps"):
            second.pop(key, None)
        second.update(width=plan["width"], height=plan["height"], latents=upscaled,
            audio_latents=audio_latents, sigmas=sigmas, noise_scale=sigmas[0],
            output_type="pil", return_dict=True, callback_on_step_end=step_reporter(len(sigmas), 67, 27))
        if stage2_conditions:
            second["conditions"] = stage2_conditions
        return run(lambda: pipe(**second))
    finally:
        pipe.scheduler = original_scheduler
        if adapters_disabled:
            pipe.enable_lora()
