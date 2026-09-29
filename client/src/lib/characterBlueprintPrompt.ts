import { listBlueprint } from "@/lib/blueprint";
import type { Character } from "@/lib/projectTypes";

const HEAD_KO = "캐릭터 레퍼런스 구성:";
const HEAD_EN = "Character reference blueprint:";

/** 조종기가 쓴 인물 프롬프트에 현재 선택된 시트 칸을 한 번만 잇습니다. */
export function relinkCharacterBlueprintPrompts(character: Character): Character {
  const selected = character.blueprint;
  const ko = listBlueprint("character", selected, "ko");
  const en = listBlueprint("character", selected, "en");
  const relink = (value: string | undefined, head: string, parts: string[]) => {
    if (!value?.trim()) return value ?? "";
    const body = value.split(/\r?\n/).filter((line) => !line.trimStart().startsWith(head)).join("\n").trim();
    const count = head === HEAD_KO ? `${parts.length}칸` : `${parts.length} panels`;
    return parts.length ? `${body}\n\n${head} ${count} — ${parts.map((part, index) => `${index + 1}. ${part}`).join(" / ")}` : body;
  };
  return {
    ...character,
    promptKo: relink(character.promptKo, HEAD_KO, ko),
    promptEn: relink(character.promptEn, HEAD_EN, en),
  };
}
