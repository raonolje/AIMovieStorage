# -*- coding: utf-8 -*-
"""상주 워커 — Rust 가 띄우고 stdin/stdout JSON 줄로 일을 시킵니다.

    python worker.py --engine spandrel --root <앱데이터>/upscale/engines/spandrel

왜 상주인가: 모델을 올리는 데 SeedVR2 7B 는 수십 초가 걸립니다. 한 장 키울 때마다
프로세스를 새로 띄우면 그 수십 초를 매번 냅니다. 그래서 프로세스를 살려 두고
`load` 로 올린 모델을 그대로 씁니다. VRAM 을 비우고 싶으면 Rust 가 `quit` 을 보냅니다.

왜 stdout 에 아무것도 쓰면 안 되는가: stdout 은 이 프로토콜 전용입니다. 엔진 코드가
`print` 를 하면 줄이 섞여 Rust 가 JSON 을 못 읽습니다. 그래서 기동하자마자 sys.stdout 을
stderr 로 바꿔치기하고(`_LineOut`), 프로토콜은 원래 stdout(`_RAW_OUT`)으로만 씁니다.

프로토콜
    요청  {"id":"1","op":"ping"|"load"|"unload"|"upscale"|"quit",
           "input":"…","output":"…","target":{"long_edge":4096},"opts":{…}}
    응답  {"id":"","event":"ready","cuda":true,"device":"…","torch":"…","vram_gb":96}
          {"id":"1","event":"progress","percent":37,"message":"타일 12/32"}
          {"id":"1","event":"done","output":"…","width":…,"height":…,"seconds":…}
          {"id":"1","event":"error","message":"…"}
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

# 프로토콜용 원래 stdout 을 먼저 붙잡아 둡니다.
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


def send(payload):
    _RAW_OUT.write(json.dumps(payload, ensure_ascii=False) + "\n")
    _RAW_OUT.flush()


def load_engine(engine_id):
    """`engines/<id>.py` 를 불러옵니다. 리소스 폴더에 같이 배포된 파일입니다."""
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

    왜 스레드인가(2026-09-09 지적): 예전에는 이 파일이 단일 스레드라 작업이 도는 동안
    stdin 을 읽지 못했습니다. 그래서 Rust 가 보낸 `quit` 은 작업이 끝나야 처리됐고,
    `stop_worker` 는 3초 유예 뒤 워커 파이썬만 끊었습니다. vosr 처럼 CLI 를 따로 띄우는
    엔진은 그 **손자**가 부모를 잃은 채 VRAM 을 문 채 살아남았습니다.

    이제 읽는 쪽이 `quit` 을 보는 즉시 `engine.abort()` 를 부릅니다(있는 엔진만 —
    vosr 뿐입니다). 모델을 통째로 내리는 `unload()` 를 여기서 부르지 않는 이유:
    torch 가 다른 스레드에서 쓰고 있는 중이라 그대로 죽습니다. `abort` 는 «우리가 띄운
    자식 핸들만 끊기» 로 한정돼 있습니다.
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
    common.log("워커 시작 — 엔진 {} · 폴더 {}".format(args.engine, root))

    try:
        engine = load_engine(args.engine)
    except Exception as error:
        common.log("엔진 모듈을 불러오지 못했습니다: {}\n{}".format(error, traceback.format_exc()))
        send({"id": "", "event": "error", "message": "엔진 모듈을 불러오지 못했습니다: {}".format(error)})
        return 1

    # 기동 직후 한 번 — 프런트의 «상태 확인» 이 이 값을 보여 줍니다.
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

        # 유휴 종료는 abort/unload를 호출하지 않고 인터프리터가 스스로 끝나게 합니다.
        if op == "quit_idle":
            send({"id": job_id, "event": "done", "graceful_only": True})
            return 0

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
                engine.load(root, opts)
                send({"id": job_id, "event": "done"})
            elif op == "unload":
                engine.unload()
                send({"id": job_id, "event": "done"})
            elif op == "upscale":
                started = time.time()

                def report(percent, message=""):
                    send({
                        "id": job_id,
                        "event": "progress",
                        "percent": None if percent is None else int(percent),
                        "message": message,
                    })

                input_path = request.get("input") or ""
                output_path = request.get("output") or ""
                if not os.path.isfile(input_path):
                    raise IOError("원본 그림을 찾지 못했습니다: {}".format(input_path))

                report(1, "모델 준비")
                engine.load(root, opts)
                image = common.open_image(input_path)
                target = request.get("target") or {}
                report(5, "업스케일 시작")
                result = engine.upscale(image, target, opts, report)
                wanted = common.resolve_target((image.width, image.height), target)
                result = common.fit_to(result, wanted)
                common.save_image(result, output_path)
                send({
                    "id": job_id,
                    "event": "done",
                    "output": output_path,
                    "width": result.width,
                    "height": result.height,
                    "seconds": round(time.time() - started, 2),
                })
            else:
                raise ValueError("모르는 명령입니다: {}".format(op))
        except Exception as error:
            common.log("작업 실패 ({}): {}\n{}".format(op, error, traceback.format_exc()))
            send({"id": job_id, "event": "error", "message": str(error)})

    return 0


if __name__ == "__main__":
    sys.exit(main())
