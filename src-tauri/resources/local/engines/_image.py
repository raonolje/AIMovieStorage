# -*- coding: utf-8 -*-
"""그림 엔진 셋이 함께 쓰는 몸통 — diffusers 파이프라인 하나를 올리고 한 장 뽑습니다.

세 엔진(Qwen-Image·Krea 2 Turbo·Z-Image Turbo)의 모델과 생성 규칙을 인자로 받습니다.
여기 한 군데에 몸통을 두는 까닭은 앱 규칙 1 과 같습니다 — 셋으로 흩어 두면
「로라를 여러 개 먹이기」 나 「시드를 돌려주기」 같은 규칙을 고칠 때 하나를 빠뜨립니다.

로라를 여러 개 먹이는 법(diffusers 규약)
    pipe.load_lora_weights(경로, adapter_name="a")
    pipe.load_lora_weights(경로, adapter_name="b")
    pipe.set_adapters(["a", "b"], adapter_weights=[0.8, 0.5])
"""

import os
import inspect
import time

import common


class ImageEngine(object):
    def __init__(
        self,
        repo,
        pipeline_name,
        default_steps,
        default_guidance,
        notes="",
        bf16_gb=24.0,
        guidance_parameter="guidance_scale",
        negative_guidance_threshold=None,
    ):
        self.repo = repo
        self.pipeline_name = pipeline_name
        self.default_steps = default_steps
        self.default_guidance = default_guidance
        # 파이프라인 이름만으로는 증류판 여부를 모릅니다. None 은 네거티브를 쓰지 않는 모델,
        # 숫자는 그보다 큰 guidance 에서 네거티브를 쓰는 모델입니다(Qwen 은 > 1).
        self.guidance_parameter = guidance_parameter
        self.negative_guidance_threshold = negative_guidance_threshold
        self.notes = notes
        # 이 모델을 bf16 그대로 올리는 데 필요한 VRAM(GB). 정밀도를 고르는 잣대입니다.
        self.bf16_gb = bf16_gb
        self.pipe = None
        # 지금 올라가 있는 것의 정밀도 계획. 없으면 아무것도 안 올라가 있다는 뜻입니다.
        self.plan = None
        self.loaded_loras = []

    # ── 살림 ────────────────────────────────────────────────────────────
    def info(self, root):
        return {"repo": self.repo, "notes": self.notes, "bf16_gb": self.bf16_gb}

    def load(self, root, opts):
        """**이 GPU 에 맞는 정밀도로 올립니다.**

        정밀도를 먼저 셈하는 까닭: 이미 올라가 있어도 **사람이 정밀도를 바꿨으면 다시
        올려야** 합니다. 여태는 로라만 다시 걸고 정밀도는 보지 않아서, bf16 → int4 로
        내려도 앞서 올린 것이 그대로 돌았습니다(판단은 `common.plan_precision` 한 곳).
        """
        plan = common.plan_precision(self.bf16_gb, opts, loaded=self.plan)
        if self.pipe is not None and not plan["reload"]:
            self._apply_loras(opts)
            return
        if self.pipe is not None:
            # 새것을 올리기 **전에** 내립니다. 안 그러면 두 벌이 잠깐 VRAM 에 겹쳐 터집니다.
            self.unload()
        import diffusers
        import torch  # noqa: F401  (device_and_dtype 가 씁니다)

        common.use_engine_cache(root)
        device, dtype = common.device_and_dtype()
        pipeline_class = getattr(diffusers, self.pipeline_name)
        common.log_precision(self.repo, plan)
        if plan["bits"]:
            transformer = common.quantized_component(self.repo, dtype, plan["bits"])
            pipe = pipeline_class.from_pretrained(
                self.repo, transformer=transformer, torch_dtype=dtype
            )
        else:
            pipe = pipeline_class.from_pretrained(self.repo, torch_dtype=dtype)
        pipe = common.place(pipe, device, bool(plan["bits"]))
        try:
            pipe.set_progress_bar_config(disable=True)
        except Exception:
            pass
        # 그림도 빠른 어텐션을 씁니다. 영상만큼 극적이진 않지만(시퀀스가 짧습니다) 큰 판이나
        # 여러 장을 이어 뽑을 때 그대로 시간이 됩니다. 이 PC 에 못 깔렸으면 알아서 내려갑니다.
        common.use_fast_attention(
            getattr(pipe, "transformer", None), getattr(pipe, "unet", None)
        )
        self.pipe = pipe
        self.plan = plan
        self.loaded_loras = []
        self._apply_loras(opts)

    def unload(self):
        self.pipe = None
        self.plan = None
        self.loaded_loras = []
        common.free_vram()

    # ── 로라 ────────────────────────────────────────────────────────────
    def _apply_loras(self, opts):
        """`opts.loras = [{"path": "...", "weight": 0.8}, …]`. 빈 목록이면 전부 뗍니다."""
        wanted = [item for item in (opts.get("loras") or []) if item.get("path")]
        signature = [(item["path"], float(item.get("weight", 1.0))) for item in wanted]
        if signature == self.loaded_loras:
            return
        try:
            self.pipe.unload_lora_weights()
        except Exception as error:
            common.log("로라를 떼지 못했습니다(무시): {}".format(error))
        names, weights = [], []
        for index, item in enumerate(wanted):
            path = item["path"]
            if not os.path.isfile(path):
                raise IOError("로라 파일을 찾지 못했습니다: {}".format(path))
            common.guard_lora_family(path)
            name = "lora{}".format(index)
            folder, filename = os.path.split(path)
            dora = common.lora_has_dora(path)
            try:
                self._load_one(path, folder, filename, name, dora)
            except Exception as error:
                # 키 수백 개가 쏟아지는 대신 「무엇이 문제고 무엇을 하면 되는가」 한 줄로.
                raise common.lora_load_error(error, path, dora)
            names.append(name)
            weights.append(float(item.get("weight", 1.0)))
        if names:
            self.pipe.set_adapters(names, adapter_weights=weights)
            # 붙었는지 세어 보고 적습니다 — 안 붙어도 diffusers 는 조용합니다.
            got = common.check_loras(
                getattr(self.pipe, "transformer", None) or getattr(self.pipe, "unet", self.pipe),
                wanted,
                os.path.basename(wanted[0]["path"]),
            )
            common.log("로라 {}개를 먹였습니다.".format(got))
        self.loaded_loras = signature

    def _load_one(self, path, folder, filename, name, dora):
        """로라 한 개를 올립니다. DoRA 일 때만 손수 읽어 이름을 맞춥니다."""
        if dora:
            # DoRA 는 키 이름만 어긋납니다. **그럴 때만** 손수 읽어 맞춥니다 — 잘 되는 길
            # (파일 자리를 그대로 넘기기)은 건드리지 않습니다. 까닭은 `common.fix_dora_keys`.
            from safetensors.torch import load_file

            self.pipe.load_lora_weights(
                common.fix_dora_keys(load_file(path, device="cpu")), adapter_name=name
            )
        else:
            self.pipe.load_lora_weights(folder, weight_name=filename, adapter_name=name)

    # ── 생성 ────────────────────────────────────────────────────────────
    def generate(self, output, opts, report):
        started = time.time()
        steps = int(opts.get("steps") or self.default_steps)
        requested_guidance = opts.get("guidance")
        guidance = float(self.default_guidance if requested_guidance is None else requested_guidance)
        width = int(opts.get("width") or 1536)
        height = int(opts.get("height") or 864)
        seed = common.resolve_seed(opts)

        kwargs = {
            "prompt": opts.get("prompt") or "",
            "num_inference_steps": steps,
            "width": width,
            "height": height,
            "generator": common.generator(seed),
            "callback_on_step_end": common.step_reporter(report, steps),
        }
        # 0 을 생략하면 Krea2Pipeline 의 기본값 4.5 가 다시 켜집니다. 빈 네거티브만으로도
        # CFG 가 돌기 때문에 네거티브를 거르는 것만으로는 증류판의 생성 조건을 지킬 수 없습니다.
        kwargs[self.guidance_parameter] = guidance
        negative = (opts.get("negative") or "").strip()
        if self.negative_guidance_threshold is not None and guidance > self.negative_guidance_threshold:
            # Qwen 은 빈 문자열도 필요합니다. None 으로 생략하면 요청한 CFG 자체가 꺼집니다.
            kwargs["negative_prompt"] = negative

        """
        **긴 프롬프트가 조용히 잘리던 것.**

        파이프라인은 텍스트 인코더의 기본 길이(Qwen-Image 는 512 토큰)만 읽고 나머지를 버립니다.
        우리 프롬프트는 상황·환경·인물·구도·빛을 다 적어 길고, **칸 배치 지시가 맨 뒤**에 있어서
        정확히 그 부분이 날아갔습니다 — 시트를 시켰는데 전혀 다른 그림이 나온 까닭입니다.
        받아 주는 파이프라인에는 길이를 명시하고, 그래도 넘치면 결과에 적어 화면이 알 수 있게 합니다.
        """
        try:
            accepts = inspect.signature(self.pipe.__call__).parameters
        except (TypeError, ValueError):
            accepts = {}
        budget = int(opts.get("max_tokens") or 1024)
        if "max_sequence_length" in accepts:
            kwargs["max_sequence_length"] = budget
        # 토큰 수는 인코더마다 다르지만, 영어는 낱말 하나에 1.3 토큰쯤입니다 — 넘치는지만 알면 됩니다.
        words = len((kwargs["prompt"] or "").split())
        rough_tokens = int(words * 1.3)
        if rough_tokens > budget:
            common.log(
                "프롬프트가 깁니다 — 낱말 {}개(약 {} 토큰), 이 모델의 한 번 한도는 {} 토큰입니다. "
                "뒤쪽이 잘릴 수 있습니다.".format(words, rough_tokens, budget)
            )

        result = common.run_attention_safe(self.pipe, lambda: self.pipe(**kwargs))
        image = result.images[0]
        image.save(output)
        out = {
            "width": image.width,
            "height": image.height,
            "seed": seed,
            "steps": steps,
            "generate_seconds": round(time.time() - started, 2),
            # 프롬프트가 한도를 넘었는지 — 화면이 「뒤쪽이 잘렸을 수 있습니다」 를 말해 줄 근거.
            "prompt_words": words,
            "prompt_budget": budget,
            "prompt_overflow": rough_tokens > budget,
        }
        # 요청한 정밀도와 실제로 올라간 정밀도 — 한 곳에서 만듭니다.
        out.update(common.precision_fields(self.plan))
        return out
