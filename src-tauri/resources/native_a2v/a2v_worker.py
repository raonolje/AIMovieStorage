"""Explicit isolated-process entry point. Prepare mode never starts inference."""
import argparse
from dataclasses import asdict
from pathlib import Path
import json
import os
import sys
import gc
import traceback

from a2v_adapter import prepare_app_request, native_ready, run_native, mux_original_audio
from memory_budget import host_memory, validate_host_memory
from gpu_handoff import consume_single_job_handoff


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--request",required=True,help="trusted local app request+owned asset manifest")
    parser.add_argument("--environment",required=True,help="verified isolated environment/weight manifest")
    parser.add_argument("--output-directory",required=True)
    parser.add_argument("--execute",action="store_true",help="explicit inference; only after setup and GPU coordination")
    args=parser.parse_args()
    request=json.loads(Path(args.request).read_text(encoding="utf8"))
    manifest=json.loads(Path(args.environment).read_text(encoding="utf8"))
    prepared=prepare_app_request(request["projectId"],request["inputs"],request["ownedAssets"])
    plan={"audio":asdict(prepared["plan"]),"offloadMode":prepared["offload_mode"],"images":prepared["images"],
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
    # 인계 뒤 워커가 보는 여유량을 다시 검사해야 사전 VRAM 기록을 보장으로 오해하지 않습니다.
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("gpu_unavailable")
    free_bytes, total_bytes = torch.cuda.mem_get_info()
    if free_bytes < 24 * 1024 ** 3:
        raise RuntimeError("insufficient_gpu_memory: experimental A2V needs the planned 24 GiB free reserve")
    Path(args.output_directory).mkdir(parents=True, exist_ok=False)
    Path(args.output_directory,"native-process.json").write_text(json.dumps({"actualPythonPid":os.getpid(),"hostMemoryBeforeModelLoad":memory,"freeGpuBytesBeforeModelLoad":free_bytes,"totalGpuBytes":total_bytes}),encoding="utf8")
    torch.cuda.reset_peak_memory_stats()
    generated=run_native(prepared,manifest,args.output_directory)
    final=mux_original_audio(manifest["ffmpeg"],prepared,generated,
                             Path(args.output_directory)/"original-audio-master.mp4")
    final["offload_mode"] = prepared["offload_mode"]
    if manifest.get("single_job_gpu_handoff"):
        grant=manifest["single_job_gpu_handoff"]
        ctx=grant["context"]
        final["gpu_handoff"]={"schema":grant["schema"],"operationId":ctx["operationId"],"projectId":ctx["projectId"],"target":ctx["target"],"requestSha256":grant["requestSha256"],"persistentExecutionPermissionChanged":False}
    final["host_memory_before_model_load"] = memory
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
