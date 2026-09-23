import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// 새 경로를 돌려주는 Rust와 화면의 약속을 봅니다. 가짜 복원 함수를 다시 구현해 시험하지 않습니다.
const file = new URL("../components/project/GeneratedImageShelf.tsx", import.meta.url);
const source = ts.createSourceFile(file.pathname, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback = "";
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "restoreProjectMediaFile(projectName, path).then")
    callback = node.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);

describe("그림 복원 경로", () => {
  it("원래 이름이 다른 그림에 쓰였으면 새로 복원된 경로와 미리보기를 붙인다", () => {
    expect(callback).not.toBe("");
    const original = { id: "old", name: "원본", filePath: "p/cut_001.png", thumb: "옛 미리보기" };
    const replacement = { id: "new", name: "새 그림", filePath: "p/cut_001.png", thumb: "새 미리보기" };
    let cards = [replacement];
    const context = vm.createContext({ image: original, path: original.filePath, assetSrc: (path: string) => `asset:${path}`, onChange: (update: (current: typeof cards) => typeof cards) => { cards = update(cards); }, toast: { success() {}, error() {} } });
    const restore = vm.runInContext(`(${callback})`, context) as (back: string) => void;
    restore("p/cut_002.png");
    expect(cards).toHaveLength(2);
    expect(cards[1]).toMatchObject({ id: "old", filePath: "p/cut_002.png", thumb: "asset:p/cut_002.png" });
    restore("p/cut_002.png");
    expect(cards).toHaveLength(2);
  });
});
