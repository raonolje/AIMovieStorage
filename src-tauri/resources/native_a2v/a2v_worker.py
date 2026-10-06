"""Explicit isolated-process entry point. Prepare mode never starts inference."""
from sdk_bootstrap import activate_if_configured
SDK_BINDING = activate_if_configured()
from ltx_core.memory_observer import MemoryRecorder, memory_phase, observe_with
import argparse
from dataclasses import asdict
from pathlib import Path
import json
import os
import sys
import gc
import traceback

from a2v_adapter import prepare_app_request, native_ready, run_native, mux_original_audio
from memory_budget import host_memory, validate_host_memory, validate_checkpoint_read_memory
from gpu_handoff import consume_single_job_handoff


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--request",required=True,help="trusted local app request+owned asset manifest")
    parser.add_argument("--environment",required=True,help="verified isolated environment/weight manifest")
    parser.add_argument("--output-directory",required=True)
    parser.add_argument("--execute",action="store_true",help="explicit inference; only after setup and GPU coordination")
    args=parser.parse_args()
    if args.execute and SDK_BINDING is None:
        raise RuntimeError("bundled_sdk_binding_required")
    request=json.loads(Path(args.request).read_text(encoding="utf8"))
    manifest=json.loads(Path(args.environment).read_text(encoding="utf8"))
    prepared=prepare_app_request(request["projectId"],request["inputs"],request["ownedAssets"])
    plan={"audio":asdict(prepared["plan"]),"offloadMode":prepared["offload_mode"],"images":prepared["images"],
          "checkpointReadPolicy":prepared["checkpoint_read_policy"],
          "nativeBlockers":native_ready(manifest),"installedAppConnected":False,
          "gpuExecuted":False,"lipSyncVerified":False}
    if not args.execute:
        print(json.dumps({"status":"prepared","plan":plan}))
        return 0
    if not consume_single_job_handoff(manifest, args.request, args.environment):
        print(json.dumps({"status":"blocked","error":"separate_gpu_handoff_required","plan":plan}))
        return 2
    if plan["nativeBlockers"]:
        print(json.dumps({"status":"blocked","plan":plan}))
        return 2
    # Process-local offline flags. No account, operating-system or production-environment edits.
    os.environ["HF_HUB_OFFLINE"]="1"
    os.environ["TRANSFORMERS_OFFLINE"]="1"
    memory = validate_host_memory(prepared["offload_mode"], host_memory())
    from ltx_core.memory_observer import host_snapshot
    read_memory=validate_checkpoint_read_memory(prepared,manifest,memory,host_snapshot()['privateCommitBytes'])
    from ltx_core.checkpoint_read_policy import configure_payload_backend
    configure_payload_backend(prepared['checkpoint_read_policy']['payloadBackend'])
    # 인계 뒤 워커가 보는 여유량을 다시 검사해야 사전 VRAM 기록을 보장으로 오해하지 않습니다.
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("gpu_unavailable")
    free_bytes, total_bytes = torch.cuda.mem_get_info()
    if free_bytes < 24 * 1024 ** 3:
        raise RuntimeError("insufficient_gpu_memory: experimental A2V needs the planned 24 GiB free reserve")
    Path(args.output_directory).mkdir(parents=True, exist_ok=False)
    Path(args.output_directory,"native-process.json").write_text(json.dumps({"actualPythonPid":os.getpid(),"hostMemoryBeforeModelLoad":memory,"checkpointReadPolicy":prepared['checkpoint_read_policy'],"checkpointReadMemory":read_memory,"freeGpuBytesBeforeModelLoad":free_bytes,"totalGpuBytes":total_bytes,"bundledSdkBinding":SDK_BINDING}),encoding="utf8")
    torch.cuda.reset_peak_memory_stats()
    # Candidate diagnostics only; this path still requires the original scoped GPU handoff.
    with MemoryRecorder(Path(args.output_directory)/"memory-phases.jsonl", include_cuda=True) as recorder, observe_with(recorder):
        with memory_phase("native.pipeline"):
            generated=run_native(prepared,manifest,args.output_directory)
        with memory_phase("audio.original_mux"):
            final=mux_original_audio(manifest["ffmpeg"],prepared,generated,
                                     Path(args.output_directory)/"original-audio-master.mp4")
    final["offload_mode"] = prepared["offload_mode"]
    final['checkpoint_read_policy']=prepared['checkpoint_read_policy']
    final['checkpoint_read_memory']=read_memory
    final['process_lifetime_peak_private_commit_bytes']=host_snapshot()['peakPrivateCommitBytes']
    if manifest.get("single_job_gpu_handoff"):
        grant=manifest["single_job_gpu_handoff"]
        ctx=grant["context"]
        final["gpu_handoff"]={"schema":grant["schema"],"operationId":ctx["operationId"],"projectId":ctx["projectId"],"target":ctx["target"],"requestSha256":grant["requestSha256"],"persistentExecutionPermissionChanged":False}
    final["host_memory_before_model_load"] = memory
    final["bundled_sdk_binding"] = SDK_BINDING
    final["cuda_peak_allocated_bytes"] = torch.cuda.max_memory_allocated()
    final["cuda_peak_reserved_bytes"] = torch.cuda.max_memory_reserved()
    Path(args.output_directory,"result.json").write_text(json.dumps(final,indent=2),encoding="utf8")
    print(json.dumps({"status":"generated","result":final,"lipSyncVerified":False}))
    return 0


def entrypoint():
    try:
        return main()
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        message = str(error)
        code = "out_of_memory" if "out of memory" in message.lower() or type(error).__name__ == "OutOfMemoryError" else "native_a2v_error"
        # 참조를 놓고 이 프로세스의 캐시만 비웁니다. 다른 엔진과 OS 설정은 건드리지 않습니다.
        error.__traceback__ = None
        gc.collect()
        torch = sys.modules.get("torch")
        cache_released = False
        if torch is not None and torch.cuda.is_initialized():
            try:
                torch.cuda.empty_cache()
                cache_released = True
            except Exception:
                pass
        print(json.dumps({"status":"error","code":code,"error":message,"ownCudaCacheReleaseAttemptSucceeded":cache_released,"qualityApproved":False,"forceTermination":False}))
        return 1


if __name__ == "__main__":
    sys.exit(entrypoint())
