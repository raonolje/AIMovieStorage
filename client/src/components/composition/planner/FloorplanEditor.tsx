import { useState, type MouseEvent } from "react";
import { useT } from "@/lib/i18n";
import type { CompositionRoom, FloorplanWall, CompositionState } from "@/lib/composition";
import { removeFloorplanWallIn, upsertFloorplanWallIn, type UpdateComposition } from "@/lib/compositionEdit";

const round = (n: number) => Math.round(n * 20) / 20;
const inputClass = "w-full rounded border border-white/15 bg-black/30 px-1 py-0.5 text-[10px] text-white";

export default function FloorplanEditor({ room, setState }: { room: CompositionRoom; setState: UpdateComposition }) {
  const t = useT();
  const [start, setStart] = useState<{ x: number; z: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const walls = room.floorplan?.walls ?? [];
  const wall = walls.find((item) => item.id === selected);
  const viewWidth = 320;
  const viewHeight = 240;
  const scale = Math.min((viewWidth - 30) / room.width, (viewHeight - 30) / room.depth);
  const px = (x: number) => viewWidth / 2 + x * scale;
  const py = (z: number) => viewHeight / 2 + z * scale;
  const update = (next: FloorplanWall) => setState((current: CompositionState) => upsertFloorplanWallIn(current, room.id, next));
  const clickPlan = (event: MouseEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM()?.inverse();
    if (!matrix) return;
    const svgPoint = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    const x = round((svgPoint.x - viewWidth / 2) / scale);
    const z = round((svgPoint.y - viewHeight / 2) / scale);
    const point = { x: Math.max(-room.width / 2, Math.min(room.width / 2, x)), z: Math.max(-room.depth / 2, Math.min(room.depth / 2, z)) };
    if (!start) { setStart(point); return; }
    if (Math.hypot(point.x - start.x, point.z - start.z) < 0.1) return;
    const id = `wall-${crypto.randomUUID()}`;
    update({ id, start, end: point, thickness: 0.12, height: room.height });
    setSelected(id);
    setStart(null);
  };
  const number = (label: string, value: number, change: (n: number) => void) => (
    <label className="text-[9px] text-slate-400">{label}
      <input className={inputClass} type="number" step="0.05" value={value} onChange={(event) => {
        const n = Number(event.target.value); if (Number.isFinite(n)) change(n);
      }} />
    </label>
  );
  return <div className="space-y-2 rounded-md border border-white/10 p-2" data-tour="env-floorplan">
    <div className="text-[11px] font-semibold text-white">{t("2D 평면도 · 실측 벽/문/창")}</div>
    <p className="text-[9px] text-slate-400">{t("빈 공간을 두 번 눌러 벽을 그리세요. 점은 0.05m 단위입니다. 기존 6면 그림은 배경으로 유지됩니다.")}</p>
    <svg aria-label={t("2D 평면도 편집")} role="application" viewBox={`0 0 ${viewWidth} ${viewHeight}`} onClick={clickPlan}
      className="w-full cursor-crosshair rounded bg-slate-950" style={{ maxHeight: 240 }}>
      <rect x={0} y={0} width={viewWidth} height={viewHeight} fill="transparent" />
      <rect x={px(-room.width / 2)} y={py(-room.depth / 2)} width={room.width * scale} height={room.depth * scale} fill="none" stroke="#475569" strokeDasharray="4 3" pointerEvents="none" />
      {walls.map((item) => <g key={item.id} onClick={(event) => { event.stopPropagation(); setSelected(item.id); }} className="cursor-pointer">
        <line x1={px(item.start.x)} y1={py(item.start.z)} x2={px(item.end.x)} y2={py(item.end.z)} stroke="transparent" strokeWidth={15} />
        <line x1={px(item.start.x)} y1={py(item.start.z)} x2={px(item.end.x)} y2={py(item.end.z)} stroke={item.id === selected ? "#a78bfa" : item.opening?.kind === "door" ? "#38bdf8" : item.opening?.kind === "window" ? "#fbbf24" : "#cbd5e1"} strokeWidth={Math.max(2, item.thickness * scale)} pointerEvents="none" />
      </g>)}
      {start && <circle cx={px(start.x)} cy={py(start.z)} r={4} fill="#a78bfa" pointerEvents="none" />}
    </svg>
    <div className="flex justify-between text-[9px] text-slate-400"><span>{t("가로")} {room.width.toFixed(1)} m · {t("깊이")} {room.depth.toFixed(1)} m</span><span>{t("벽")} {walls.length}</span></div>
    {start && <button type="button" className="text-[10px] text-violet-300" onClick={() => setStart(null)}>{t("첫 점 취소")}</button>}
    {wall && <div className="space-y-1 border-t border-white/10 pt-2">
      <div className="flex items-center justify-between text-[10px] text-white"><span>{t("선택한 벽")} · {Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z).toFixed(2)} m</span><button type="button" className="text-red-300" onClick={() => { setState((current) => removeFloorplanWallIn(current, room.id, wall.id)); setSelected(null); }}>{t("벽 삭제")}</button></div>
      <div className="grid grid-cols-4 gap-1">
        {number(t("시작 X"), wall.start.x, (x) => update({ ...wall, start: { ...wall.start, x } }))}
        {number(t("시작 Z"), wall.start.z, (z) => update({ ...wall, start: { ...wall.start, z } }))}
        {number(t("끝 X"), wall.end.x, (x) => update({ ...wall, end: { ...wall.end, x } }))}
        {number(t("끝 Z"), wall.end.z, (z) => update({ ...wall, end: { ...wall.end, z } }))}
        {number(t("두께 m"), wall.thickness, (thickness) => update({ ...wall, thickness }))}
        {number(t("높이 m"), wall.height, (height) => update({ ...wall, height }))}
      </div>
      <label className="text-[9px] text-slate-400">{t("개구부")}
        <select className={inputClass} value={wall.opening?.kind ?? "none"} onChange={(event) => update({ ...wall, opening: event.target.value === "none" ? undefined : { kind: event.target.value as "door" | "window", width: 0.9, bottom: event.target.value === "door" ? 0 : 0.9, height: event.target.value === "door" ? 2 : 1.1 } })}>
          <option value="none">{t("없음")}</option><option value="door">{t("문")}</option><option value="window">{t("창")}</option>
        </select>
      </label>
      {wall.opening && <div className="grid grid-cols-3 gap-1">
        {number(t("개구부 폭 m"), wall.opening.width, (width) => update({ ...wall, opening: { ...wall.opening!, width } }))}
        {number(t("바닥 높이 m"), wall.opening.bottom, (bottom) => update({ ...wall, opening: { ...wall.opening!, bottom } }))}
        {number(t("개구부 높이 m"), wall.opening.height, (height) => update({ ...wall, opening: { ...wall.opening!, height } }))}
      </div>}
    </div>}
  </div>;
}
