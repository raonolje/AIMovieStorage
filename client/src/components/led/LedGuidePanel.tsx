import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import {
  actorProjection,
  decodeLedPreset,
  encodeLedPreset,
  fitLedGuide,
  guideOutside,
  guideRect,
  nextLedColor,
  loadLedPresets,
  newLedId,
  normalizeLedSettings,
  saveLedPresets,
  type LedGuide,
  type LedGuidePreset,
  type LedGuideSettings,
} from "@/lib/ledGuides";

const field =
  "min-w-0 rounded border border-white/20 bg-black/25 px-2 py-1 text-xs text-white";
const button =
  "rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40";
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const t = useT();
  return (
    <label className="grid gap-1 text-xs">
      {t(label)}
      <input
        className={field}
        aria-label={t(label)}
        type="number"
        value={Number(value.toFixed(5))}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          if (e.target.value === "") return;
          const n = e.target.valueAsNumber;
          if (
            Number.isFinite(n) &&
            (min === undefined || n >= min) &&
            (max === undefined || n <= max)
          )
            onChange(n);
        }}
      />
    </label>
  );
}
export default function LedGuidePanel({
  settings,
  aspect,
  onChange,
}: {
  settings: LedGuideSettings;
  aspect: number;
  onChange: (s: LedGuideSettings) => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState(settings.guides[0]?.id ?? "");
  const [name, setName] = useState("");
  const [presets, setPresets] = useState<LedGuidePreset[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const g =
    settings.guides.find((g) => g.id === selected) ?? settings.guides[0];
  const a = settings.actor,
    projection = actorProjection(settings, aspect);
  const update = (s: LedGuideSettings) => onChange(normalizeLedSettings(s));
  const patch = (p: Partial<LedGuide>) =>
    g &&
    update({
      ...settings,
      guides: settings.guides.map((x) => (x.id === g.id ? { ...x, ...p } : x)),
    });
  const actor = (p: Partial<typeof a>) =>
    update({ ...settings, actor: { ...a, ...p } });
  useEffect(() => {
    try {
      setPresets(loadLedPresets());
    } catch {
      toast.error(
        t("저장된 LED 배치를 읽지 못했습니다. 파일 불러오기를 이용해 주세요."),
      );
    }
  }, [t]);
  const add = () => {
    if (settings.guides.length >= 32) return;
    const id = newLedId();
    setSelected(id);
    update({
      ...settings,
      guides: [
        ...settings.guides,
        {
          id,
          name: `LED ${settings.guides.length + 1}`,
          color: nextLedColor(settings.guides),
          visible: true,
          ratioWidth: 16,
          ratioHeight: 9,
          fit: "height",
          x: 0,
          y: 0,
          width: 1,
          physicalHeightM: 2.5,
        },
      ],
      actor: { ...a, guideId: a.guideId || id },
    });
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([encodeLedPreset(name.trim() || t("LED 배치"), settings)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "LED-guide.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section data-led-panel className="space-y-3 text-white">
      <div className="flex flex-wrap gap-2">
        <button
          className={button}
          onClick={() => update({ ...settings, visible: !settings.visible })}
        >
          {t(settings.visible ? "가이드 전체 숨기기" : "가이드 전체 표시")}
        </button>
        <button
          className={button}
          onClick={add}
          disabled={settings.guides.length >= 32}
        >
          {t("영역 추가")}
        </button>
      </div>
      <p className="text-xs text-white/60">
        {t(
          "가이드와 실루엣은 확인용이며 시작 이미지·영상 출력에는 포함되지 않습니다. 테두리를 끌어 이동하고 오른쪽 아래 손잡이로 크기를 조절하세요.",
        )}
      </p>
      <div className="space-y-1">
        {settings.guides.map((item) => (
          <div className="flex items-center gap-2" key={item.id}>
            <input
              type="checkbox"
              aria-label={`${item.name} ${t("표시")}`}
              checked={item.visible}
              onChange={(e) =>
                update({
                  ...settings,
                  guides: settings.guides.map((x) =>
                    x.id === item.id ? { ...x, visible: e.target.checked } : x,
                  ),
                })
              }
            />
            <button
              className={`${button} flex-1 text-left`}
              style={{
                borderColor: item.color,
                background: g?.id === item.id ? `${item.color}22` : undefined,
              }}
              onClick={() => setSelected(item.id)}
            >
              {item.name}
            </button>
            <button
              className={button}
              aria-label={`${item.name} ${t("삭제")}`}
              onClick={() =>
                update({
                  ...settings,
                  guides: settings.guides.filter((x) => x.id !== item.id),
                })
              }
            >
              {t("삭제")}
            </button>
          </div>
        ))}
      </div>
      {g && (
        <fieldset className="space-y-2 rounded border border-white/15 p-2">
          <legend className="text-xs">{t("선택한 LED 영역")}</legend>
          <div className="flex gap-2">
            <input
              className={`${field} flex-1`}
              aria-label={t("영역 이름")}
              value={g.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
            <input
              aria-label={t("영역 색")}
              type="color"
              value={g.color}
              onChange={(e) => patch({ color: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="비율 가로"
              value={g.ratioWidth}
              min={0.01}
              onChange={(ratioWidth) => patch({ ratioWidth })}
            />
            <NumberField
              label="비율 높이"
              value={g.ratioHeight}
              min={0.01}
              onChange={(ratioHeight) => patch({ ratioHeight })}
            />
          </div>
          <label className="grid gap-1 text-xs">
            {t("크기 맞춤")}
            <select
              className={field}
              aria-label={t("크기 맞춤")}
              value={g.fit}
              onChange={(e) =>
                patch(fitLedGuide(g, e.target.value as LedGuide["fit"], aspect))
              }
            >
              <option value="width">{t("화면 가로에 맞춤")}</option>
              <option value="height">{t("화면 높이에 맞춤")}</option>
              <option value="free">{t("자유 크기")}</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="왼쪽 위치 (%)"
              value={g.x * 100}
              min={-1000}
              max={1000}
              onChange={(x) => patch({ x: x / 100 })}
            />
            <NumberField
              label="위쪽 위치 (%)"
              value={g.y * 100}
              min={-1000}
              max={1000}
              onChange={(y) => patch({ y: y / 100 })}
            />
            <NumberField
              label="화면 대비 폭 (%)"
              value={guideRect(g, aspect).width * 100}
              min={0.1}
              max={1000}
              onChange={(width) => patch({ width: width / 100, fit: "free" })}
            />
            <NumberField
              label="LED 실제 높이 (m)"
              value={g.physicalHeightM}
              min={0.01}
              onChange={(physicalHeightM) => patch({ physicalHeightM })}
            />
          </div>
          {guideOutside(g, aspect) && (
            <p role="status" className="text-xs text-amber-300">
              {t(
                "영역 일부가 영상 밖에 있습니다. 위치 또는 크기를 조절하세요.",
              )}
            </p>
          )}
        </fieldset>
      )}
      <fieldset className="space-y-2 rounded border border-white/15 p-2">
        <legend className="text-xs">{t("배우 실루엣")}</legend>
        <label className="flex gap-2 text-xs">
          <input
            type="checkbox"
            checked={a.visible}
            onChange={(e) => actor({ visible: e.target.checked })}
          />
          {t("실루엣 표시")}
        </label>
        <label className="grid gap-1 text-xs">
          {t("기준 LED 영역")}
          <select
            className={field}
            aria-label={t("기준 LED 영역")}
            value={a.guideId}
            onChange={(e) => actor({ guideId: e.target.value })}
          >
            <option value="" disabled>
              {t("영역을 추가하세요")}
            </option>
            {settings.guides.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="배우 키 (cm)"
            value={a.heightCm}
            min={1}
            max={400}
            onChange={(heightCm) => actor({ heightCm })}
          />
          <NumberField
            label="LED 앞 거리 (m)"
            value={a.forwardM}
            min={0}
            onChange={(forwardM) => actor({ forwardM })}
          />
          <NumberField
            label="관객에서 LED 거리 (m)"
            value={a.viewerDistanceM}
            min={0.01}
            onChange={(viewerDistanceM) => actor({ viewerDistanceM })}
          />
          <NumberField
            label="기준 영역 안 좌우 (%)"
            value={a.x * 100}
            onChange={(x) => actor({ x: x / 100 })}
          />
          <NumberField
            label="기준 영역 안 발 위치 (%)"
            value={a.footY * 100}
            onChange={(footY) => actor({ footY: footY / 100 })}
          />
          <NumberField
            label="실루엣 불투명도 (%)"
            value={a.opacity * 100}
            min={10}
            max={100}
            step={1}
            onChange={(opacity) => actor({ opacity: opacity / 100 })}
          />
        </div>
        {a.forwardM >= a.viewerDistanceM ? (
          <p role="alert" className="text-xs text-amber-300">
            {t("배우의 LED 앞 거리는 관객에서 LED까지 거리보다 작아야 합니다.")}
          </p>
        ) : (
          projection && (
            <p className="text-xs text-white/70">
              {t("LED 높이 대비 배우 높이")}:{" "}
              {(projection.relativeHeight * 100).toFixed(1)}%
            </p>
          )
        )}
        <p className="text-xs text-white/50">
          {t(
            "LED를 정면에서 보는 원근 크기 비교입니다. 실제 꺾인 패널의 투시·바닥 높이를 자동 복원하지 않습니다. 발 위치는 화면에서 조절할 수 있습니다.",
          )}
        </p>
      </fieldset>
      <fieldset className="space-y-2 rounded border border-white/15 p-2">
        <legend className="text-xs">{t("공용 LED 배치")}</legend>
        <input
          className={`${field} w-full`}
          placeholder={t("배치 이름")}
          aria-label={t("배치 이름")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button
            className={button}
            disabled={!name.trim()}
            onClick={() => {
              try {
                const rows = [
                  ...loadLedPresets(),
                  {
                    id: newLedId(),
                    name: name.trim(),
                    settings: normalizeLedSettings(settings),
                  },
                ];
                saveLedPresets(rows);
                setPresets(rows);
                toast.success(t("공용 LED 배치를 저장했습니다."));
              } catch {
                toast.error(
                  t("LED 배치를 저장하지 못했습니다. 파일로 내보내 주세요."),
                );
              }
            }}
          >
            {t("새 배치로 저장")}
          </button>
          <button className={button} onClick={download}>
            {t("파일 내보내기")}
          </button>
          <button className={button} onClick={() => file.current?.click()}>
            {t("파일 불러오기")}
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              if (f.size > 1_000_000) throw new Error();
              const d = decodeLedPreset(await f.text());
              update(d.settings);
              setName(d.name);
            } catch {
              toast.error(t("올바른 LED 가이드 설정 파일을 선택해 주세요."));
            }
          }}
        />
        {presets.map((p) => (
          <div key={p.id} className="flex gap-2">
            <button
              className={`${button} flex-1 text-left`}
              onClick={() => {
                update(p.settings);
                setName(p.name);
              }}
            >
              {p.name} · {t("불러오기")}
            </button>
            <button
              className={button}
              aria-label={`${p.name} ${t("배치 삭제")}`}
              onClick={() => {
                try {
                  const rows = loadLedPresets().filter((x) => x.id !== p.id);
                  saveLedPresets(rows);
                  setPresets(rows);
                } catch {
                  toast.error(t("배치를 삭제하지 못했습니다."));
                }
              }}
            >
              {t("삭제")}
            </button>
          </div>
        ))}
        <p className="text-xs text-white/50">
          {t(
            "구도잡기와 이미지 편집에서 같은 배치를 불러옵니다. 다른 컴퓨터로 옮길 때는 설정 파일을 사용하세요.",
          )}
        </p>
      </fieldset>
    </section>
  );
}
