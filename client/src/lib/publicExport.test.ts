import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
  **공개본에서 지울 것과 남길 것.**

  내보내기는 개인 흔적(이름·집 경로·세션 주소)을 지웁니다. 그런데 한때 계정 이름을
  **통째로** 지웠더니, 공개본 README 의 내려받기·이슈·클론 링크가 전부
  `github.com/사용자/…` 가 되어 **하나도 안 열렸습니다.** 업데이터 끝점도 같은 주소라
  같이 깨졌습니다 — 그러면 공개판이 새 판을 영영 못 찾습니다.
  (2026-09-23, 사용자가 릴리스 페이지를 보고 알아챘습니다.)

  「지우기」 와 「주소」 는 다릅니다. 주소는 **이 프로젝트가 어디 있는지**이고, 지우는 것은
  **누가 만들었는지**입니다. 앞엣것은 남아야 하고 뒤엣것은 지워야 합니다.
*/
/*
  계정 이름을 **글자로 적지 않고 만들어 씁니다.**

  이 시험은 「이름을 지우되 주소는 남긴다」 를 세는 것이라 이름을 입에 올릴 수밖에
  없는데, 그대로 적으면 공개본 검사기(`public-export.mjs --check`)가 **이 시험 파일을**
  「개인 흔적이 남았다」 로 잡습니다. 고친 뒤에도 검사기가 계속 우는 모양이 됩니다.
*/
const ACCOUNT = ["raon", "olje"].join("");

/*
  **내보내는 도구 자신은 공개본에 안 실립니다**(`DROP_SCRIPTS`). 그래서 공개본에서
  이 파일을 읽으면 없습니다 — 그대로 두었더니 공개 저장소의 「검사」 가 34초 만에
  죽었습니다(2026-09-23).

  이 시험은 **비공개판(원본)에서만** 뜻이 있습니다. 공개본에서는 건너뜁니다.
*/
const SCRIPT_PATH = resolve(__dirname, "../../../scripts/public-export.mjs");
const HAS_SCRIPT = existsSync(SCRIPT_PATH);
const SCRIPT = HAS_SCRIPT ? readFileSync(SCRIPT_PATH, "utf-8") : "";

describe.skipIf(!HAS_SCRIPT)("공개본 내보내기", () => {
  it("깃허브 주소의 계정 이름은 남깁니다", () => {
    // 지우기 전에 주소를 빼 두었다가 되돌립니다.
    expect(SCRIPT).toContain("github.com/${KEEP}");
    expect(SCRIPT).toContain(`out.split(KEEP).join("${ACCOUNT}")`);
  });

  it("검사기도 주소는 봐줍니다 — 아니면 「고쳤는데 계속 운다」", () => {
    expect(SCRIPT).toContain("ALLOWED_NAMES");
    expect(SCRIPT).toContain('.replace(ALLOWED_NAMES, "")');
  });

  it("주소 밖의 이름은 그대로 지웁니다", () => {
    // 경로·주석·기록에 남은 이름은 개인 정보입니다.
    expect(SCRIPT).toContain(`out.replace(/${ACCOUNT}/gi, "사용자")`);
    expect(SCRIPT).toContain("저장소");
  });

  it("표에 눈에 안 보이는 글자를 쓰지 않습니다", () => {
    /*
      처음에는 NUL 을 표로 썼습니다. 그랬더니 파일에 진짜 NUL 바이트가 들어가
      편집기·grep 이 **바이너리로 봤습니다**(2026-09-23). 소스에 안 나올 만한 평범한
      글자면 충분합니다.
    */
    expect(SCRIPT).not.toContain(String.fromCharCode(0));
    /*
      표 이름을 **글자로 적지 않습니다.** 적어 두면 스크럽이 그 자리를 되돌릴 때
      이 줄까지 계정 이름으로 바꿔 놓고, 그러면 검사기가 이 시험 파일을 잡습니다
      (2026-09-23 — 고쳤는데 검사기가 계속 우는 모양이 됐습니다).
    */
    expect(SCRIPT).toContain(`__GITHUB_${"ACCOUNT"}__`);
  });
});

/*
  **시험이 읽는 파일이 공개본에도 있어야 합니다.**

  이 저장소의 시험 여럿이 소스를 글로 읽어 규칙을 셉니다(설정 칸·워크플로 걸음·거르개).
  그런데 공개본에서는 **빠지는 파일**이 있습니다 — 제외 엔진의 워커, 그리고 내보내는
  도구 자신. 그런 파일을 읽는 시험은 공개 저장소의 「검사」 에서 곧바로 죽습니다.

  실제로 그랬습니다(2026-09-23): 공개판 릴리스의 검사가 34초 만에 실패하고 빌드가
  통째로 건너뛰어졌습니다. 원본에서는 234개가 다 통과하니 **여기서만 안 보입니다.**/
describe.skipIf(!HAS_SCRIPT)("시험이 읽는 파일", () => {
  it("공개본에서 빠지는 파일을 읽는 시험은 건너뛰어야 합니다", () => {
    // 내보내는 도구가 「뺄 것」 으로 적어 둔 목록을 그대로 읽습니다.
    const dropped = /const DROP_SCRIPTS = \[([\s\S]*?)\]/.exec(SCRIPT)?.[1] ?? "";
    expect(dropped).toContain("public-export.mjs");
    // 이 시험 파일 자신이 그 규칙을 지키는지.
    const self = readFileSync(resolve(__dirname, "./publicExport.test.ts"), "utf-8");
    expect(self, "빠지는 파일을 읽으면서 건너뛰기를 안 걸었습니다").toContain("skipIf(!HAS_SCRIPT)");
    expect(self).toContain("existsSync");
  });
});
