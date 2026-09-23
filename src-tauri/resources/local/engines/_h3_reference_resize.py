# -*- coding: utf-8 -*-
"""Ref2VA 그림만 제작자의 match 규약으로 줄이고 공식 입력 검사는 재사용합니다.

규약: https://github.com/ModelTC/Minimax-H3-Turbo/blob/main/minimax_h3_ref2va_pipeline.py
기본값은 기존 Diffusers 방식입니다. 영상의 시각/프레임과 오디오 처리는 바꾸지 않습니다.
"""
from diffusers.modular_pipelines.minimax_h3.before_encoder import MiniMaxH3Ref2VASetupStep
from diffusers.modular_pipelines.minimax_h3.modular_blocks_minimax_h3 import (
    MiniMaxH3AutoBeforeEncodeStep, MiniMaxH3Blocks,
)
from diffusers.modular_pipelines.minimax_h3.modular_pipeline import MiniMaxH3ModularPipeline, resolve_canvas_size
from diffusers.modular_pipelines.modular_pipeline_utils import InputParam

from engines._h3_lora_contract import reference_match_size


class _MatchImageProcessor:
    def __init__(self, original, width, height, multiple):
        self.original, self.width, self.height, self.multiple = original, width, height, multiple
        self.resized = set()

    def __getattr__(self, name):
        return getattr(self.original, name)

    def resize(self, image, **_stock_size):
        height, width = reference_match_size(*image.size, self.width, self.height, self.multiple)
        result = image if image.size == (width, height) else self.original.resize(image, height=height, width=width)
        self.resized.add(id(result))
        return result


class _LocalComponents:
    """호출 하나의 전처리기만 감쌉니다. 공유 pipeline/config를 임시 변경하지 않습니다."""
    def __init__(self, original, processor):
        self.original, self.image_processor = original, processor

    def __getattr__(self, name):
        return getattr(self.original, name)


class H3ReferenceResizeSetup(MiniMaxH3Ref2VASetupStep):
    @property
    def inputs(self):
        return [*super().inputs, InputParam(
            name="reference_resize_mode", type_hint=str, default="diffusers",
            description="diffusers: original 2048 short edge; match: reference image area follows the target without upscaling.",
        )]

    def __call__(self, components, state):
        inputs = self.get_block_state(state)
        mode = inputs.reference_resize_mode
        if mode not in ("diffusers", "match"):
            raise ValueError("H3 reference_resize_mode는 diffusers 또는 match여야 합니다.")
        if mode == "diffusers":
            return super().__call__(components, state)
        height, width = inputs.height, inputs.width
        if (height is None) != (width is None):
            raise ValueError("H3 참조 그림의 목표 너비와 높이는 함께 지정해야 합니다.")
        if height is None:
            height, width = resolve_canvas_size(16, 9, components.canvas_multiple,
                components.config.canvas_short_edge, components.config.canvas_max_pixels)
        processor = _MatchImageProcessor(components.image_processor, width, height, components.canvas_multiple)
        # 공식 블록이 검증/형식 변환을 마친 PIL 그림에만 resize를 호출합니다.
        # 영상/소리의 별도 정규화 함수와 참조 순서는 원래 블록이 그대로 처리합니다.
        _, state = super().__call__(_LocalComponents(components, processor), state)
        for entry in state.get("normalized_references"):
            # 원본이 정확히 2048 short edge이면 stock 블록은 resize 호출을 생략합니다.
            if entry.kind == "image" and id(entry.image) not in processor.resized:
                entry.image = processor.resize(entry.image)
        return components, state


class H3ReferenceResizeBeforeEncode(MiniMaxH3AutoBeforeEncodeStep):
    block_classes = [H3ReferenceResizeSetup, *MiniMaxH3AutoBeforeEncodeStep.block_classes[1:]]


class H3ReferenceResizeBlocks(MiniMaxH3Blocks):
    block_classes = [H3ReferenceResizeBeforeEncode, *MiniMaxH3Blocks.block_classes[1:]]


def reference_pipeline(model_id, components_manager):
    return MiniMaxH3ModularPipeline(blocks=H3ReferenceResizeBlocks(),
        pretrained_model_name_or_path=model_id, components_manager=components_manager)
