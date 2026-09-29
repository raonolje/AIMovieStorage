import { useState } from "react";
import { Loader2, Sparkles, UserSearch } from "lucide-react";
import { toast } from "sonner";
import AutoTextarea from "@/components/AutoTextarea";
import { LlmRequestButton } from "@/components/LlmRequestButton";
import { parseJsonResponse, useLlmReady } from "@/lib/llm";
import { requestJsonFromLlm } from "@/lib/promptRequest";
import { characterProfileRequestData } from "@/lib/supplementalPromptPayload";
import {
  PROFILE_FIELDS,
  normalizeProfile,
  type CharacterProfile,
} from "@/lib/characterProfile";

/**
 * 캐릭터의 «생김새가 아닌 것» 을 적는 자리.
 *
 * 손으로 적어도 되고, LLM 에게 정해 달라고 해도 됩니다. 성격·말투·버릇은
 * 매번 머리에서 짜내기 어렵고, 짜낼 때마다 조금씩 달라져서 컷마다 다른 사람이
 * 연기하게 됩니다.
 *
 * 버튼이 둘인 이유는 키가 없는 사람도 쓸 수 있어야 하기 때문입니다.
 * «LLM 요청문» 은 글을 만들어 주기만 하고, 사용자가 직접 챗 창에 붙여넣습니다.
 * «특징 정하기» 는 API 로 바로 받아 칸을 채웁니다. 둘이 보내는 글은 같습니다.
 */
export default function CharacterProfilePanel({
  profile,
  onChange,
  basics,
  projectContext,
  projectName,
  images = [],
}: {
  profile?: Partial<CharacterProfile> | null;
  onChange: (next: CharacterProfile) => void;
  /** 캐릭터 카드에 이미 있는 값. 프로필과 어긋나지 않게 함께 보냅니다. */
  basics: { name?: string; role?: string; gender?: string; heightCm?: number; description?: string };
  projectContext: unknown;
  projectName?: string;
  /** 이 인물의 그림. 그림과 맞는 설정이 나오게 함께 올립니다. */
  images?: string[];
}) {
  const value = normalizeProfile(profile);
  const [writing, setWriting] = useState(false);
  const ready = useLlmReady("characterProfile");

  const set = (id: keyof CharacterProfile, next: string) =>
    onChange({ ...value, [id]: next });

  /** 요청문에 실어 보낼 것. 두 버튼이 같은 것을 씁니다. */
  const requestData = () => characterProfileRequestData({ project: projectContext, projectName, basics, profile: value });

  /**
   * 돌려받은 칸만 덮어씁니다. 빠뜨린 칸까지 비우면 적어 둔 것이 날아갑니다.
   * API 로 받았든 요청문 답을 붙여넣었든 **같은 길**을 지납니다.
   */
  const fill = (answer: Partial<CharacterProfile>) => {
    const next = { ...value };
    let filled = 0;
    for (const field of PROFILE_FIELDS) {
      const incoming = (answer[field.id] || "").trim();
      if (incoming) { next[field.id] = incoming; filled += 1; }
    }
    if (!filled) { toast.error("돌려받은 내용이 비어 있습니다."); return; }
    onChange(next);
    toast.success(`특징 ${filled}칸을 채웠습니다. 마음에 안 드는 곳은 고쳐 쓰세요.`);
  };

  const ask = async () => {
    setWriting(true);
    try {
      const answer = await requestJsonFromLlm<Partial<CharacterProfile>>({
        label: `${basics.name || "이름 없음"} · 특징 정하기`,
        deliveredTo: `${basics.name || "이름 없음"} · 캐릭터 특징에 넣음`,
        task: "characterProfile",
        template: "character-profile",
        data: requestData(),
        images: images.slice(0, 2),
      });

      fill(answer);
    } catch (error) {
      toast.error(`특징을 받지 못했습니다. ${error}`);
    } finally {
      setWriting(false);
    }
  };

  const short = PROFILE_FIELDS.filter(field => !field.long);
  const long = PROFILE_FIELDS.filter(field => field.long);

  return (
    <section
      className="rounded-lg p-3"
      style={{ background: "oklch(0.12 0.008 265)", border: "1px solid oklch(0.55 0.15 200 / 25%)" }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <UserSearch className="h-3.5 w-3.5 shrink-0" style={{ color: "oklch(0.74 0.14 200)" }} />
        <p className="text-xs font-semibold" style={{ color: "oklch(0.80 0.11 200)" }}>
          캐릭터 특징
        </p>
        <p className="min-w-0 flex-1 text-[10px]" style={{ color: "oklch(0.44 0.01 265)" }}>
          시트에 글자로 찍히고, 영상 프롬프트에서 이 인물의 연기 기준이 됩니다
        </p>

        <LlmRequestButton
          template="character-profile"
          title="캐릭터 특징 정하기 요청문"
          data={requestData}
          imageCount={() => Math.min(images.length, 2)}
          applyTextLabel="캐릭터 특징"
          onApplyText={(raw) => {
            try {
              fill(parseJsonResponse<Partial<CharacterProfile>>(raw));
            } catch {
              toast.error("JSON 을 읽지 못했습니다. 답변에서 { … } 부분만 붙여넣어 주세요.");
            }
          }}
        />
        <button
          type="button"
          onClick={() => void ask()}
          data-tour="card-profile"
          disabled={writing || !ready}
          title={ready ? undefined : "설정에서 API 키를 넣으면 바로 받을 수 있습니다"}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold text-white gradient-primary disabled:opacity-35"
        >
          {writing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {writing ? "정하는 중…" : "특징 정하기"}
        </button>
      </div>

      {/* 짧은 값은 나란히. 한 줄에 하나씩 두면 화면만 길어집니다. */}
      <div className="mb-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {short.map(field => (
          <label key={field.id} className="block">
            <span className="mb-1 block text-[10px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
              {field.label}
            </span>
            <input
              value={value[field.id]}
              onChange={event => set(field.id, event.target.value)}
              placeholder={field.placeholder}
              className="w-full rounded-md px-2 py-1.5 text-xs outline-none"
              style={{
                background: "oklch(0.10 0.006 265)",
                border: "1px solid oklch(1 0 0 / 10%)",
                color: "oklch(0.86 0.005 265)",
              }}
            />
          </label>
        ))}
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {long.map(field => (
          <label key={field.id} className="block">
            <span className="mb-1 block text-[10px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
              {field.label}
            </span>
            <AutoTextarea
              value={value[field.id]}
              onChange={event => set(field.id, event.target.value)}
              placeholder={field.placeholder}
              minRows={2}
              className="w-full resize-none rounded-md px-2 py-1.5 text-xs leading-relaxed outline-none"
              style={{
                background: "oklch(0.10 0.006 265)",
                border: "1px solid oklch(1 0 0 / 10%)",
                color: "oklch(0.86 0.005 265)",
              }}
            />
          </label>
        ))}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed" style={{ color: "oklch(0.42 0.01 265)" }}>
        찍을 수 있는 말로 적으세요. «생각이 깊다» 는 화면에 안 나오지만
        «생각할 때 귀 끝을 만진다» 는 나옵니다.
      </p>
    </section>
  );
}
