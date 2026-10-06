"""Isolated native A2V bridge. Does not install packages or modify the existing engine.

The public app must expose this engine only after native_ready() succeeds in its
separate interpreter. This module's prepare path imports no GPU libraries.
"""
from ltx_core.memory_observer import memory_phase
from dataclasses import dataclass, asdict, replace
from fractions import Fraction
from pathlib import Path
from hashlib import sha256
import importlib.util
import importlib.metadata
import inspect
import json
import math
import subprocess
import wave
import struct
import sys


def _number(value, name, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"invalid_request: {name} must be finite")
    if value < 0 or (positive and value == 0):
        raise ValueError(f"invalid_request: {name} is out of range")
    return Fraction(str(value))


def file_sha(path):
    digest = sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True)
class AudioPlan:
    source: str
    source_sha256: str
    sample_rate: int
    channels: int
    sample_width: int
    start_sample: int
    end_sample: int
    requested_duration: float
    effective_duration: float
    fps: int
    visible_frames: int
    generation_frames: int
    generation_samples: int
    padding_samples: int


def plan_audio(source, start_seconds, duration_seconds, fps=24):
    start = _number(start_seconds, "audioStartSeconds")
    duration = _number(duration_seconds, "audioDurationSeconds", positive=True)
    if isinstance(fps, bool) or not isinstance(fps, int) or not 1 <= fps <= 60:
        raise ValueError("invalid_request: fps must be an integer in 1..60")
    source = str(Path(source).resolve(strict=True))
    with wave.open(source, "rb") as audio:
        channels, width, rate, count, compression, _ = audio.getparams()
        if compression != "NONE" or channels != 2 or width != 2:
            raise ValueError("unsupported_audio: isolated bridge requires stereo PCM16 WAV")
        first = round(start * rate)
        if first >= count:
            raise ValueError("invalid_request: audio offset is at or after EOF")
        wanted = round(duration * rate)
        if wanted < 1:
            raise ValueError("invalid_request: audio duration is shorter than one sample")
        last = min(count, first + wanted)
    actual = Fraction(last - first, rate)
    visible = math.ceil(actual * fps)
    frames = ((visible - 1 + 7) // 8) * 8 + 1
    if frames > 1025:
        raise ValueError("unsupported_duration: split the source into shorter A2V segments")
    generated_samples = math.ceil(Fraction(frames * rate, fps))
    return AudioPlan(source, file_sha(source), rate, channels, width, first, last,
                     float(duration), float(actual), fps, visible, frames,
                     generated_samples, generated_samples - (last - first))


def prepare_app_request(project_id, request, assets):
    """Resolve app asset IDs; no untrusted free path, URL, or upload input."""
    if request.get("engine") != "ltx-a2v-native":
        raise ValueError("model_unsupported: isolated A2V engine required")
    offload_mode = request.get("offloadMode", "cpu")
    if offload_mode not in ("cpu", "disk"):
        raise ValueError("unsupported_options: native offloadMode must be cpu or disk")
    read_backend=request.get("checkpointReadBackend","pread")
    if not isinstance(read_backend,str) or read_backend not in ("mmap","pread"):
        raise ValueError("unsupported_options: checkpointReadBackend must be mmap or pread")
    explicit=request.get("checkpointReadBackendExplicit","checkpointReadBackend" in request)
    if not isinstance(explicit,bool):
        raise ValueError("invalid_request: checkpointReadBackendExplicit")
    if (explicit or read_backend=="mmap") and offload_mode!="disk":
        raise ValueError("unsupported_options: explicit checkpointReadBackend requires disk offload")
    if read_backend=="mmap" and not explicit:
        raise ValueError("invalid_request: mmap must be explicitly selected")
    if offload_mode=="disk" and not explicit:
        raise ValueError("invalid_request: explicit checkpointReadBackend required for disk")
    by_id = {asset["id"]: asset for asset in assets}

    def asset_path(key, kind, required=False):
        asset_id = request.get(key)
        if asset_id is None and not required:
            return None
        asset = by_id.get(asset_id)
        if not asset or asset.get("projectId") != project_id or asset.get("kind") != kind:
            raise ValueError(f"invalid_asset: {key} must be a same-project {kind}")
        path = asset.get("filePath")
        if not isinstance(path, str) or "://" in path or not Path(path).is_file():
            raise ValueError(f"invalid_asset: {key} needs an existing local file")
        return str(Path(path).resolve(strict=True))

    source = asset_path("audioAssetId", "audio", True)
    first = asset_path("imageAssetId", "image")
    end = asset_path("endImageAssetId", "image")
    if end and not first:
        raise ValueError("invalid_request: end image requires first image")
    seed = request.get("seed", 0)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 2147483647:
        raise ValueError("invalid_request: seed must be an integer in 0..2147483647")
    width, height = request.get("width", 768), request.get("height", 512)
    if any(isinstance(x, bool) or not isinstance(x, int) or x < 64 or x % 64 for x in (width, height)):
        raise ValueError("invalid_request: two-stage dimensions must be positive multiples of 64")
    plan = plan_audio(source, request.get("audioStartSeconds", 0),
                      request.get("audioDurationSeconds"), request.get("fps", 24))
    images = []
    if first:
        images.append((first, 0, 1.0))
    if end:
        # The end condition belongs to the visible clip, before any temporal pad.
        images.append((end, plan.visible_frames - 1, 1.0))
    return {"plan": plan, "images": images, "seed": seed, "width": width, "height": height,
            "offload_mode": offload_mode,
            "checkpoint_read_policy":{"requestedBackend":read_backend if explicit else None,
                "payloadBackend":read_backend,"metadataBackend":"pread","explicitlySelected":explicit,
                "legacyBackend":"pread","automaticFallback":False,
                "tradeoff":"pread can be much slower; transient mapping and full GPU peak remain unverified"},
            "prompt": str(request.get("prompt") or ""),
            "negative_prompt": str(request.get("negativePrompt") or "")}


def write_audio_segments(plan, destination):
    """Sample-exact selected PCM sidecar plus zero-padded conditioning WAV."""
    destination = Path(destination)
    if file_sha(plan.source) != plan.source_sha256:
        raise RuntimeError("source_changed: original WAV changed before preparation")
    destination.mkdir(parents=True, exist_ok=True)
    with wave.open(plan.source, "rb") as source:
        source.setpos(plan.start_sample)
        pcm = source.readframes(plan.end_sample - plan.start_sample)
    paths = {"original_segment": destination / "original-segment.wav",
             "conditioning": destination / "conditioning-padded.wav"}
    if any(path.exists() for path in paths.values()):
        raise FileExistsError("segment output already exists; use a fresh job directory")
    for name, path in paths.items():
        with open(path, "xb") as raw, wave.open(raw, "wb") as target:
            target.setnchannels(plan.channels)
            target.setsampwidth(plan.sample_width)
            target.setframerate(plan.sample_rate)
            target.writeframes(pcm)
            if name == "conditioning":
                target.writeframes(b"\0" * (plan.padding_samples * plan.channels * plan.sample_width))
    if file_sha(plan.source) != plan.source_sha256:
        raise RuntimeError("source_changed: original WAV changed during preparation")
    return {key: str(path) for key, path in paths.items()}


def native_ready(manifest):
    """Fail before any torch import/model load. No automatic install or fallback."""
    blockers = []
    isolated_python = manifest.get("isolated_python")
    if not isinstance(isolated_python, str) or Path(isolated_python).resolve() != Path(sys.executable).resolve():
        blockers.append("isolated_interpreter_required")
    if "local/engines/ltx25/.venv" in str(Path(sys.executable)).replace("\\", "/").lower():
        blockers.append("production_interpreter_prohibited")
    for package in ("ltx_core", "ltx_pipelines", "torchaudio", "einops", "scipy", "colour", "OpenImageIO", "cloudpickle"):
        if importlib.util.find_spec(package) is None:
            blockers.append("missing_package:" + package)
    try:
        parts = importlib.metadata.version("transformers").split(".")
        version = tuple(map(int, parts[:2]))
        if not (5, 8) <= version < (5, 15):
            blockers.append("transformers_version_conflict")
    except importlib.metadata.PackageNotFoundError:
        blockers.append("missing_package:transformers")
    for key in ("transformer", "video_vae", "audio_vae", "spatial_upsampler", "distilled_lora"):
        path = manifest.get(key)
        if not isinstance(path, str) or not Path(path).is_file():
            blockers.append("missing_weight:" + key)
    text_encoder = manifest.get("text_encoder")
    if not isinstance(text_encoder, str):
        blockers.append("missing_weight:text_encoder")
    elif Path(text_encoder).is_dir():
        folder = Path(text_encoder)
        required = ("config.json", "tokenizer.json", "tokenizer_config.json", "processor_config.json")
        if not all((folder/name).is_file() for name in required) or not list(folder.glob("model*.safetensors")):
            blockers.append("gemma_directory_assets_incomplete")
        projection = manifest.get("embeddings_projection")
        if not isinstance(projection, str) or not Path(projection).is_file():
            blockers.append("missing_weight:embeddings_projection")
    elif not Path(text_encoder).is_file():
        blockers.append("missing_weight:text_encoder")
    if manifest.get("native_weight_contract_verified") is not True:
        blockers.append("native_weight_contract_unverified")
    transformer = manifest.get("transformer")
    if isinstance(transformer, str) and Path(transformer).is_file():
        try:
            with open(transformer, "rb") as stream:
                header_size = struct.unpack("<Q", stream.read(8))[0]
                if header_size > 20_000_000:
                    raise ValueError("invalid header")
                header = json.loads(stream.read(header_size))
                metadata = header.get("__metadata__", {})
                if isinstance(text_encoder, str) and Path(text_encoder).is_dir():
                    expected = metadata.get("gemma_source_checkpoint")
                    if isinstance(expected, str):
                        expected = json.loads(expected)
                    actual = json.loads((Path(text_encoder)/"config.json").read_text(encoding="utf8"))
                    if not isinstance(expected, dict) or expected.get("gemma_version") != actual.get("gemma_version"):
                        blockers.append("gemma_version_incompatible")
                if not metadata.get("config") or not str(metadata.get("model_version", "")).startswith("2.5"):
                    blockers.append("native_transformer_metadata_incompatible")
        except (ValueError, OSError, struct.error):
            blockers.append("native_transformer_metadata_invalid")
    return blockers


def native_call_kwargs(prepared, conditioning_path):
    plan = prepared["plan"]
    return {"prompt": prepared["prompt"], "negative_prompt": prepared["negative_prompt"],
            "seed": prepared["seed"], "height": prepared["height"], "width": prepared["width"],
            "num_frames": plan.generation_frames, "frame_rate": plan.fps,
            "images": prepared["images"], "audio_path": conditioning_path,
            "audio_start_time": 0.0, "audio_max_duration": None,
            "enhance_prompt": False}


def native_model_paths(manifest):
    """Use the official directory-capable ModelPaths API with explicit embeddings sources."""
    from ltx_pipelines.utils.model_paths import ModelPaths
    paths = ModelPaths.from_split(transformer_path=manifest["transformer"],
                                 text_encoder_path=manifest["text_encoder"],
                                 video_vae_path=manifest["video_vae"],
                                 audio_vae_path=manifest["audio_vae"])
    if Path(manifest["text_encoder"]).is_dir():
        projection = manifest.get("embeddings_projection")
        if not isinstance(projection, str) or not Path(projection).is_file():
            raise ValueError("missing_weight:embeddings_projection")
        paths = replace(paths, embeddings_weight_paths=(manifest["transformer"], projection))
    return paths


def run_native(prepared, manifest, output_directory):
    blockers = native_ready(manifest)
    if blockers:
        raise RuntimeError("native_not_ready: " + ", ".join(blockers))
    import torch
    # 공식 CLI의 추론 경계는 생성자부터 지연 decode까지 감쌉니다. 학습용 autograd는 켜지 않습니다.
    with torch.inference_mode():
        return _run_native_inference(prepared, manifest, output_directory)


def _run_native_inference(prepared, manifest, output_directory):
    blockers = native_ready(manifest)
    if blockers:
        raise RuntimeError("native_not_ready: " + ", ".join(blockers))
    # These imports run only in the separate approved native interpreter.
    from ltx_pipelines.a2vid_two_stage import A2VidPipelineTwoStage
    from ltx_pipelines.utils.model_paths import ModelPaths
    from ltx_core.loader import LoraPathStrengthAndSDOps, LTXV_LORA_COMFY_RENAMING_MAP
    from ltx_pipelines.utils.types import OffloadMode, ImageConditioningInput
    from ltx_pipelines.utils.constants import detect_params
    from ltx_pipelines.utils.media_io import encode_video
    source = inspect.getsource(A2VidPipelineTwoStage.stream_chunks)
    if source.count("freeze_audio=True") < 2 or "audio_decoder=None" not in source or "replace_chunks_audio" not in source:
        raise RuntimeError("native_contract_changed: verify both-stage audio freeze before model load")
    paths = native_model_paths(manifest)
    # construct using the official LoRA tuple API; no downloaded resolver paths
    lora = LoraPathStrengthAndSDOps(manifest["distilled_lora"], 1.0, LTXV_LORA_COMFY_RENAMING_MAP)
    segments = write_audio_segments(prepared["plan"], output_directory)
    pipeline = A2VidPipelineTwoStage(model_paths=paths, distilled_lora=[lora],
                                   spatial_upsampler_path=manifest["spatial_upsampler"],
                                   loras=[], offload_mode=OffloadMode(prepared["offload_mode"]))
    kwargs = native_call_kwargs(prepared, segments["conditioning"])
    kwargs["images"] = [ImageConditioningInput(*image) for image in kwargs["images"]]
    params = detect_params(manifest["transformer"])
    result = pipeline(**kwargs, num_inference_steps=params.num_inference_steps,
                      video_guider_params=params.video_guider_params)
    silent = str(Path(output_directory) / "generated-padded-silent.mp4")
    # Output uses the original sidecar, never generated sound or padded conditioning audio.
    from ltx_core.model.video_vae import get_video_chunks_number
    with memory_phase("video.encode"):
        encode_video(video=result.video, audio=None, fps=prepared["plan"].fps,
                     output_path=silent,
                     video_chunks_number=get_video_chunks_number(result.num_frames, result.tiling_config))
    return {"silent_video": silent, **segments, "generation": asdict(prepared["plan"]), "offload_mode": prepared["offload_mode"],
            "lip_sync_verified": False, "actual_hearing": False}


def final_mux_command(ffmpeg, silent_video, original_segment, output, plan, audio_codec="alac"):
    if audio_codec not in ("alac", "aac"):
        raise ValueError("unsupported_audio_codec")
    return [str(ffmpeg), "-nostdin", "-n", "-i", str(silent_video), "-i", str(original_segment),
            "-map", "0:v:0", "-map", "1:a:0", "-vf",
            "trim=duration=" + format(plan.effective_duration, ".9f") + ",setpts=PTS-STARTPTS",
            "-c:v", "libx264", "-bf", "0", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", audio_codec,
            "-t", format(plan.effective_duration, ".9f"), "-movflags", "+faststart", str(output)]


def precise_duration_remux(intermediate, output, plan):
    """Crop only final video packet duration; source PCM/ALAC packets are copied.

    Intermediate must be encoded with B frames disabled. All visible frame PTS
    stay at requested fps; the final displayed frame can have a shorter duration.
    No frame is stretched to mask insufficient generation.
    """
    import av
    if Path(output).exists():
        raise FileExistsError("output already exists")
    target_duration = Fraction(plan.end_sample - plan.start_sample, plan.sample_rate)
    with av.open(str(intermediate)) as source, av.open(str(output), "w") as destination:
        streams = {stream.index: destination.add_stream_from_template(stream) for stream in source.streams}
        for stream in source.streams:
            if stream.type == "video":
                streams[stream.index].time_base = Fraction(1, plan.sample_rate)
        for packet in source.demux():
            if packet.dts is None:
                continue
            original = packet.stream
            if original.type == "video":
                pts = packet.pts * packet.time_base
                if pts >= target_duration:
                    continue
                dts = packet.dts * packet.time_base
                end = min(target_duration, pts + packet.duration * packet.time_base)
                packet.pts = round(pts * plan.sample_rate)
                packet.dts = round(dts * plan.sample_rate)
                packet.duration = round(end * plan.sample_rate) - packet.pts
                packet.time_base = Fraction(1, plan.sample_rate)
            packet.stream = streams[original.index]
            destination.mux(packet)


def mux_original_audio(ffmpeg, prepared, generated, output, audio_codec="alac"):
    plan = prepared["plan"]
    output = Path(output)
    if output.exists():
        raise FileExistsError("output already exists")
    intermediate = output.with_name(output.stem + ".mux-intermediate.mp4")
    command = final_mux_command(ffmpeg, generated["silent_video"], generated["original_segment"],
                                intermediate, plan, audio_codec)
    subprocess.run(command, check=True, capture_output=True)
    precise_duration_remux(intermediate, output, plan)
    return {**generated, "video": str(output), "audio_codec": audio_codec,
            "audio_reencoded": True, "audio_lossy_reencoded": audio_codec == "aac",
            "lossless_pcm_master": audio_codec == "alac",
            "video_reencoded": True, "last_frame_duration_adjusted": True,
            "duration_tolerance_seconds": 1 / plan.sample_rate,
            "source_unchanged": file_sha(plan.source) == plan.source_sha256}
