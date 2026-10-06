"""Consume only the trusted app's request-scoped handoff; retain legacy global gate."""
import hashlib
import json
import time
from pathlib import Path

def consume_single_job_handoff(manifest, request_file, environment_file, now=None):
    grant = manifest.get("single_job_gpu_handoff")
    if grant is None:
        return manifest.get("gpu_execution_authorized") is True
    request_file, environment_file = Path(request_file), Path(environment_file)
    if request_file.parent.resolve() != environment_file.parent.resolve():
        raise ValueError("gpu_handoff_workspace_mismatch")
    if grant.get("schema") != "native-gpu-single-job-v1":
        raise ValueError("gpu_handoff_invalid_schema")
    current = time.time() if now is None else now
    if not grant.get("approvedAtUnix", 0) <= current <= grant.get("expiresAtUnix", 0) or grant["expiresAtUnix"] - grant["approvedAtUnix"] > 60:
        raise ValueError("gpu_handoff_expired")
    if grant.get("requestSha256") != hashlib.sha256(request_file.read_bytes()).hexdigest():
        raise ValueError("gpu_handoff_request_mismatch")
    ctx = grant.get("context", {})
    if json.loads(request_file.read_text(encoding="utf8")).get("gpuHandoffContext") != ctx:
        raise ValueError("gpu_handoff_context_mismatch")
    approval = ctx.get("approval", {})
    if approval.get("producerSafeBoundaryConfirmed") is not True or not ctx.get("operationId") or approval.get("requestId") != ctx.get("operationId") or not ctx.get("projectId") or approval.get("projectId") != ctx.get("projectId") or approval.get("target") != ctx.get("target") or ctx.get("target", {}).get("kind") != "cut" or not ctx.get("target", {}).get("id"):
        raise ValueError("gpu_handoff_identity_mismatch")
    if not grant.get("nonce"):
        raise ValueError("gpu_handoff_missing_nonce")
    marker = environment_file.parent / "gpu-handoff-worker-consumed.json"
    with marker.open("x", encoding="utf8") as output:
        json.dump({"requestSha256": grant["requestSha256"], "nonce": grant["nonce"], "consumedAtUnix": current}, output)
    return True
