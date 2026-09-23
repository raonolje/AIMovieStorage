# -*- coding: utf-8 -*-
"""상주 워커 — Rust 가 띄우고 stdin/stdout JSON 줄로 일을 시킵니다.

    python worker.py --engine qwenimage --root <앱데이터>/local/engines/qwenimage

업스케일 워커와 **같은 프로토콜**입니다(`resources/upscale/worker.py`). 다른 것은 `op`
하나뿐 — 이쪽은 `generate` 로 파일을 만들어 냅니다. 같은 모양으로 둔 까닭: Rust 쪽
`ensure_worker`·`ask`·`stop_worker` 를 두 갈래가 그대로 나눠 쓰기 때문입니다.

왜 상주인가: Qwen-Image 20B 를 올리는 데만 수십 초입니다. 한 장마다 프로세스를 새로
띄우면 그 시간을 매번 냅니다.

왜 stdout 에 아무것도 쓰면 안 되는가: stdout 은 이 프로토콜 전용입니다. diffusers 의
진행 막대나 엔진의 print 가 섞이면 Rust 가 JSON 을 못 읽습니다. 그래서 기동하자마자
sys.stdout 을 stderr 로 바꿔치기하고, 프로토콜은 원래 stdout 으로만 씁니다.

프로토콜
    요청  {"id":"1","op":"ping"|"load"|"unload"|"generate"|"prefetch"|"quit",
           "output":"…","opts":{…}}
    응답  {"id":"","event":"ready","cuda":true,"device":"…","torch":"…","vram_gb":96}
          {"id":"1","event":"progress","percent":37,"message":"12/28 스텝"}
          {"id":"1","event":"progress","stage":"models","percent":41,"message":"… 78.2 / 190.0 GB"}
          {"id":"1","event":"done","output":"…","seconds":…, …엔진이 덧붙인 값}
          {"id":"1","event":"done","prefetched":true}          (prefetch 의 답)
          {"id":"1","event":"error","message":"…"}

`prefetch` 는 가중치를 **미리** 받는 명령입니다(). 엔진 모듈에
`prefetch(root, report)` 가 있으면 그것을 부르고, 없으면(첫 생성 때 받는 엔진) 바로 done 이되
`prefetched: false` 입니다 — Rust 는 이 값이 참일 때만 «가중치 있음» 으로 적습니다.
진행 줄의 `stage` 는 Rust 가 어느 막대를 움직일지 고르는 표시입니다 — 없으면 «생성(run)» 이고,
미리 받기는 설치 때의 «가중치 받기(models)» 막대를 그대로 씁니다. 같은 막대라야 설치 화면이
설치 중이든 단추로 받는 중이든 한 모양으로 보입니다.
"""

import os
import sys
import json
import time
import queue
import argparse
import threading
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

_RAW_OUT = sys.stdout


class _LineOut(object):
    """엔진이 print 한 것을 stderr(로그 파일)로 보냅니다."""

    def write(self, text):
        sys.stderr.write(text)

    def flush(self):
        sys.stderr.flush()

    def isatty(self):
        return False


sys.stdout = _LineOut()

import common  # noqa: E402  (stdout 바꿔치기 뒤에 불러야 합니다)
from control_policy import validate_control_options


def send(payload):
    _RAW_OUT.write(json.dumps(payload, ensure_ascii=False) + "\n")
    _RAW_OUT.flush()


def _reporter(job_id, stage=None):
    """엔진에 넘길 `report(percent, message)` — 진행 줄 한 모양을 여기서만 만듭니다.

    생성과 미리 받기가 각자 만들면 필드 하나(예: `stage`)를 한쪽만 고치는 날이 옵니다.
    """

    def report(percent, message=""):
        line = {
            "id": job_id,
            "event": "progress",
            "percent": None if percent is None else int(percent),
            "message": message,
        }
        if stage:
            line["stage"] = stage
        send(line)

    return report


def load_engine(engine_id):
    import importlib

    return importlib.import_module("engines." + engine_id)



def _take_stdin():
    """요청을 읽을 입력을 **따로 떼어** 둡니다(윈도).

    2026-09-16 실측(GVHMR): 읽기 스레드가 `sys.stdin`(fd 0)에서 기다리는 동안 본 스레드가 새 DLL(numpy·ffmpeg 류)을
    불러오면 워커가 **영원히 멈췄습니다**(CPU 0, 오류 없음). C 런타임의 `_read(0)` 이 fd 0 의 잠금을 쥔 채 기다리고, DLL 초기화가
    fd 0 을 만지다 그 잠금을 기다리는 교착입니다. 같은 코드를 스레드 없이 돌리면 멀쩡했습니다.
    그래서 fd 0 을 복제해 그 복제본으로 읽고, fd 0 자리에는 NUL 을 꽂아 둡니다 — DLL 이 만지는 fd 0 과 스레드가 기다리는 fd 가
    달라 서로 잠금을 다투지 않습니다.
    """
    if os.name != "nt":
        return sys.stdin
    import io as _io

    raw = os.dup(0)
    null = os.open(os.devnull, os.O_RDONLY)
    os.dup2(null, 0)
    os.close(null)
    return _io.TextIOWrapper(_io.FileIO(raw, "rb", closefd=True), encoding="utf-8")


_STDIN = None

def _requests(engine):
    """stdin 을 **따로 도는 스레드**로 읽어 요청을 하나씩 내놓습니다.

    작업이 도는 동안에도 `quit` 을 볼 수 있어야 합니다. 안 그러면 앱을 닫을 때
    영상 한 편이 끝날 때까지 파이썬이 VRAM 을 문 채 남습니다.
    """
    box = queue.Queue()

    def reader():
        for line in _STDIN or sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except Exception as error:
                common.log("요청을 읽지 못했습니다: {} ({})".format(line[:200], error))
                continue
            if request.get("op") == "quit" and hasattr(engine, "abort"):
                try:
                    engine.abort()
                except Exception as error:
                    common.log("작업을 끊지 못했습니다: {}".format(error))
            box.put(request)
        box.put(None)

    threading.Thread(target=reader, daemon=True).start()
    while True:
        request = box.get()
        if request is None:
            return
        yield request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", required=True)
    parser.add_argument("--root", required=True)
    args = parser.parse_args()

    global _STDIN
    _STDIN = _take_stdin()

    root = os.path.abspath(args.root)
    common.use_engine_cache(root)
    common.log("워커 시작 — 엔진 {} · 폴더 {}".format(args.engine, root))

    try:
        engine = load_engine(args.engine)
    except Exception as error:
        common.log("엔진 모듈을 불러오지 못했습니다: {}\n{}".format(error, traceback.format_exc()))
        send({"id": "", "event": "error", "message": "엔진 모듈을 불러오지 못했습니다: {}".format(error)})
        return 1

    info = {"id": "", "event": "ready"}
    try:
        info.update(common.torch_info())
    except Exception as error:
        common.log("torch 정보를 읽지 못했습니다: {}".format(error))
        info.update({"cuda": False, "device": "", "torch": "", "vram_gb": 0})
    if hasattr(engine, "info"):
        try:
            info.update(engine.info(root) or {})
        except Exception as error:
            common.log("엔진 정보를 읽지 못했습니다: {}".format(error))
    send(info)

    for request in _requests(engine):
        job_id = str(request.get("id", ""))
        op = request.get("op", "")
        opts = request.get("opts") or {}

        if op == "quit":
            try:
                engine.unload()
            except Exception:
                pass
            send({"id": job_id, "event": "done"})
            return 0

        try:
            if op == "ping":
                send({"id": job_id, "event": "done"})
            elif op == "load":
                validate_control_options(args.engine, opts, check_files=True)
                engine.load(root, opts)
                send({"id": job_id, "event": "done"})
            elif op == "unload":
                engine.unload()
                common.free_vram()
                send({"id": job_id, "event": "done"})
            elif op == "prefetch":
                # 가중치를 미리. 없는 엔진은 첫 생성 때 받는 쪽이라 할 일이 없습니다 — 바로 done.
                # `prefetched` 로 «정말 받았는지» 를 같이 알립니다 — Rust 가 done 만 보고 weights_ready 를 적으면
                # 모듈에 prefetch 가 빠진 엔진이 «다 받았다» 로 남아 첫 생성이 다시 수십 GB 를 받습니다(2026-09-22 점검).
                prefetched = hasattr(engine, "prefetch")
                if prefetched:
                    engine.prefetch(root, _reporter(job_id, stage="models"))
                send({"id": job_id, "event": "done", "prefetched": prefetched})
            elif op == "generate":
                validate_control_options(args.engine, opts, check_files=True)
                started = time.time()
                report = _reporter(job_id)

                output_path = request.get("output") or ""
                folder = os.path.dirname(output_path)
                if not folder or not os.path.isdir(folder):
                    raise IOError("결과를 놓을 폴더가 없습니다: {}".format(folder))

                report(1, "모델 준비 (가중치가 없으면 여기서 내려받습니다)")
                try:
                    engine.load(root, opts)
                    report(8, "생성 시작")
                    extra = engine.generate(output_path, opts, report) or {}
                finally:
                    # 살아 있는 모델은 임의로 지우지 않습니다. 작업 사이의 임시 객체와 캐시를
                    # 먼저 정리하고, Rust가 사용률/설정에 따라 이 자식 프로세스의 수명을 정합니다.
                    common.free_vram()
                if not os.path.isfile(output_path):
                    raise IOError("엔진이 결과 파일을 만들지 않았습니다.")

                done = {
                    "id": job_id,
                    "event": "done",
                    "output": output_path,
                    "seconds": round(time.time() - started, 2),
                }
                done.update(extra)
                done["memory"] = common.memory_usage()
                send(done)
            else:
                raise ValueError("모르는 명령입니다: {}".format(op))
        except Exception as error:
            common.log("작업 실패 ({}): {}\n{}".format(op, error, traceback.format_exc()))
            send({"id": job_id, "event": "error", "message": str(error)})

    return 0


if __name__ == "__main__":
    sys.exit(main())
