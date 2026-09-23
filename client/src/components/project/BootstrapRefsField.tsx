import { useRef, useState } from "react";
import { Film, ImageIcon, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { assetSrc, saveProjectMediaAsset } from "@/lib/mediaLibrary";
import { fieldStyle } from "@/components/project/fieldStyle";
import { refTag, type BootstrapRef } from "@/lib/bootstrapStore";

/**
 * **일괄 생성에 함께 올리는 그림·영상.**
 *
 * # 왜 «무엇을 참조할지» 를 따로 적는가
 *
 * 파일만 올리면 모델은 그것을 **무엇으로 쓸지** 모릅니다. 같은 춤 영상이라도 「이 안무
 * 그대로」 와 「이런 분위기로」 는 전혀 다른 작품이 됩니다. 그래서 파일마다 한 줄을 받습니다.
 *
 * # 그림과 영상은 가는 길이 다릅니다
 *
 * - **그림** — 모델에게 **그대로 보여 줍니다**(API 의 그림 칸).
 * - **영상** — API 로 올릴 수 없습니다. 그래서 적어 준 말만 글로 실어 보내고, **파일은
 * 프로젝트 폴더에 둡니다.** 경로가 있어야 모캡으로 동작을 뽑거나 영상 레퍼런스로
 * 이어 쓸 수 있습니다 — 올려 두고 끝나면 그 영상은 앱 어디에도 없는 것이 됩니다.
 */
export default function BootstrapRefsField({
  projectName,
  refs,
  onChange,
  disabled,
}: {
  projectName: string;
  refs: BootstrapRef[];
  onChange: (next: BootstrapRef[]) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const take = async (files: File[]) => {
    if (!files.length || disabled) return;
    if (!projectName.trim()) {
      toast.error("먼저 제목을 적어 주세요.", {
        description: "프로젝트 폴더가 있어야 올린 파일을 둘 자리가 생깁니다.",
      });
      return;
    }
    setBusy(true);
    try {
      const made: BootstrapRef[] = [];
      for (const file of files) {
        const video = file.type.startsWith("video/");
        if (!video && !file.type.startsWith("image/")) {
          toast.error(`${file.name} 은(는) 그림도 영상도 아닙니다.`);
          continue;
        }
        /*
          **파일 이름을 이름표로 바꿔 둡니다** — `ref_img_1` · `ref_mov_2`.

           올린 이름을 그대로 두면
          해시태그·이모지가 섞인 긴 이름이 폴더에 남고, 화면에서 「ref_img_1」 이라고
          부르는 것과 폴더 속 파일이 **서로 다른 이름**이 됩니다. 나중에 폴더를 열었을
          때 어느 것이 무엇인지 알 수가 없습니다.

          번호는 **갈래 안에서** 셉니다. 이미 있는 것과 이번에 함께 올린 것을 같이 세어
          다음 번호를 붙입니다.
        */
        const already = [...refs, ...made].filter(
          (item) => item.kind === (video ? "video" : "image"),
        ).length;
        const stem = `ref_${video ? "mov" : "img"}_${already + 1}`;
        const saved = await saveProjectMediaAsset(file, {
          projectName,
          assetType: video ? "scene-video" : "scene-cut",
          ownerName: "일괄 생성 참고",
          stem,
        });
        if (!saved?.path) {
          toast.error(`${file.name} 을(를) 폴더에 두지 못했습니다.`);
          continue;
        }
        made.push({
          id: Math.random().toString(36).slice(2),
          path: saved.path,
          name: saved.name || stem,
          kind: video ? "video" : "image",
          note: "",
        });
      }
      if (made.length) onChange([...refs, ...made]);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };

  const patch = (id: string, note: string) =>
    onChange(refs.map((item) => (item.id === id ? { ...item, note } : item)));

  /*
    목록에서 빼도 **파일은 지우지 않습니다.** 규칙 3(화면 삭제 = 파일 삭제)의 예외인
    까닭: 여기서 뺀다는 것은 「이번 생성에는 안 쓴다」 는 뜻이지 「이 영상을 버린다」 가
    아닙니다. 올린 춤 영상은 모캡에서 계속 쓸 것이고, 파일 삭제는 그 자리에서 합니다.
  */
  const drop = (id: string) => onChange(refs.filter((item) => item.id !== id));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold" style={{ color: "oklch(0.72 0.01 265)" }}>
          참고할 그림 · 영상 (선택)
        </span>
        <span className="text-[10px]" style={{ color: "oklch(0.42 0.01 265)" }}>
          파일마다 «무엇을 어떻게 쓸지» 를 적어 주세요
        </span>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void take(Array.from(event.dataTransfer.files));
        }}
        onClick={() => !disabled && picker.current?.click()}
        className="flex cursor-pointer items-center justify-center gap-2 rounded-md py-3 text-[11px]"
        style={{
          background: over ? "oklch(0.62 0.22 290 / 12%)" : "oklch(0.11 0.007 265)",
          border: `1px dashed ${over ? "oklch(0.62 0.22 290 / 60%)" : "oklch(1 0 0 / 14%)"}`,
          color: "oklch(0.58 0.01 265)",
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {busy ? "폴더에 두는 중…" : "여기로 끌어다 놓거나 눌러서 고르기 — 그림·영상"}
      </div>
      <input
        ref={picker}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(event) => {
          void take(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />

      {refs.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-2 rounded-md px-2 py-1.5"
          style={{ background: "oklch(0.12 0.008 265)", border: "1px solid oklch(1 0 0 / 8%)" }}
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded"
            style={{ background: "oklch(0.09 0.006 265)" }}
          >
            {item.kind === "image" && assetSrc(item.path) ? (
              <img src={assetSrc(item.path)} alt="" className="h-9 w-9 object-cover" />
            ) : item.kind === "video" ? (
              <Film className="h-4 w-4" style={{ color: "oklch(0.70 0.14 45)" }} />
            ) : (
              <ImageIcon className="h-4 w-4" style={{ color: "oklch(0.40 0.01 265)" }} />
            )}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex items-center gap-1 truncate text-[10px]" style={{ color: "oklch(0.60 0.01 265)" }}>
              {/*
                **이름표를 보여 줍니다.** 이 글자를
                시나리오에 그대로 적으면 그 파일을 가리킵니다 — 화면에 안 보이면
                무엇을 적어야 할지 알 수가 없습니다. 눌러서 복사합니다.
              */}
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(refTag(refs, item.id));
                  toast.success(`${refTag(refs, item.id)} 을(를) 복사했습니다.`, {
                    description: "시나리오에 그대로 붙여 넣으면 이 파일을 가리킵니다.",
                  });
                }}
                title="눌러서 복사 — 시나리오에 이 이름을 적으면 이 파일을 가리킵니다"
                className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold tabular-nums"
                style={{
                  background: "oklch(0.55 0.15 200 / 22%)",
                  color: "oklch(0.80 0.12 200)",
                }}
              >
                {refTag(refs, item.id)}
              </button>
              <span className="truncate">
                {item.name}
                {item.kind === "video" ? " · 영상" : " · 그림"}
              </span>
            </p>
            <input
              value={item.note}
              onChange={(event) => patch(item.id, event.target.value)}
              disabled={disabled}
              placeholder={
                item.kind === "video"
                  ? "이 영상의 안무를 그대로 쓰고, 인물과 배경만 바꿔 주세요"
                  : "이 그림의 색감과 분위기를 따라 주세요"
              }
              className="w-full rounded px-2 py-1 text-[11px] outline-none"
              style={fieldStyle}
            />
          </div>
          <button
            type="button"
            onClick={() => drop(item.id)}
            disabled={disabled}
            title="이번 생성에서만 뺍니다 — 폴더의 파일은 그대로 둡니다"
            className="shrink-0 rounded p-1 hover:bg-white/10"
            style={{ color: "oklch(0.60 0.01 265)" }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {refs.some((item) => item.kind === "video") && (
        <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.44 0.01 265)" }}>
          영상은 API 로 올릴 수 없어 <b>적어 주신 말</b>만 함께 갑니다 — 파일은 프로젝트 폴더에
          두었으니, 동작을 그대로 쓰려면 구도잡기의 <b>모션 캡처</b>에서 이 영상을 불러 뼈를 뽑으세요.
        </p>
      )}
    </div>
  );
}
