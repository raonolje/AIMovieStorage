"""생성 요청의 네트워크 정책은 GUI 환경 상속에 맡기지 않습니다."""
import contextlib
import importlib
import os
import socket
from unittest.mock import patch


class LocalOnlyError(RuntimeError):
    pass


def require_policy(request):
    if request.get("network_policy", "local-only") != "local-only":
        raise LocalOnlyError("로컬 생성은 local-only 정책만 허용합니다. 다운로드는 생성 요청에서 허용되지 않습니다.")
    if (request.get("opts") or {}).get("local_files_only") is False:
        raise LocalOnlyError("로컬 생성에서 local_files_only=false는 허용되지 않습니다.")


def local_load_kwargs():
    return {"local_files_only": True}


@contextlib.contextmanager
def generation_scope(request):
    require_policy(request)
    def denied(*args, **kwargs):
        raise LocalOnlyError("로컬 전용 생성: 네트워크 접근을 차단했습니다. 필요한 모델 파일을 로컬에서 확인하세요.")
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch.dict(os.environ, {
            "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
            "HF_DATASETS_OFFLINE": "1", "AISTORAGE_GENERATION_NETWORK_POLICY": "local-only",
        }))
        # 이미 import된 Hub도 환경 변수를 다시 읽지 않으므로 상수를 함께 제한합니다.
        try:
            constants = importlib.import_module("huggingface_hub.constants")
        except ImportError:
            constants = None
        if constants is not None:
            stack.enter_context(patch.object(constants, "HF_HUB_OFFLINE", True))
        transformers_hub = __import__("sys").modules.get("transformers.utils.hub")
        if transformers_hub is not None and hasattr(transformers_hub, "_is_offline_mode"):
            stack.enter_context(patch.object(transformers_hub, "_is_offline_mode", True))
        stack.enter_context(patch.object(socket.socket, "connect", denied))
        stack.enter_context(patch.object(socket.socket, "connect_ex", denied))
        stack.enter_context(patch.object(socket, "create_connection", denied))
        stack.enter_context(patch.object(socket.socket, "sendto", denied))
        stack.enter_context(patch.object(socket.socket, "send", denied))
        stack.enter_context(patch.object(socket.socket, "sendall", denied))
        stack.enter_context(patch.object(socket, "getaddrinfo", denied))
        stack.enter_context(patch.object(socket, "gethostbyname", denied))
        stack.enter_context(patch.object(socket, "gethostbyname_ex", denied))
        stack.enter_context(patch.object(socket, "gethostbyaddr", denied))
        try:
            yield
        except LocalOnlyError:
            raise
        except Exception as error:
            message = str(error).lower()
            if type(error).__name__ in {"LocalEntryNotFoundError", "OfflineModeIsEnabled"} or (
                isinstance(error, (OSError, FileNotFoundError)) and any(
                    text in message for text in ["local", "no file", "not found", "does not appear to have a file", "no such file"]
                )
            ):
                raise LocalOnlyError("로컬 전용 생성: 필요한 모델 파일이 없거나 읽을 수 없습니다. 다운로드하지 않았습니다. " + str(error)) from error
            raise
