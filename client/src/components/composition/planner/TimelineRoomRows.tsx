import { useT } from "@/lib/i18n";
import { ChevronDown, ChevronRight } from "lucide-react";
import { gutterStyle } from "./timelineParts";
import {
  COMPOSITION_CUBE_FACES,
  CUBE_FACE_LABELS,
  type CompositionCubeFace,
  type CompositionState,
} from "@/lib/composition";
import {
  type UpdateComposition,
  objectSeeThroughAtIn,
  objectsInRoom,
  occludeAtIn,
  occludeTracksOf,
  roomsOf,
  toggleObjectSeeThroughKeyIn,
  toggleOccludeKeyIn,
} from "@/lib/compositionEdit";

/**
 * 방 줄이 찍는 키는 **가림 트랙의 키**뿐입니다(면의 «가림», 소품의 «투시»).
 * 부모가 만든 끌기 손잡이를 그대로 받으므로 모양도 부모 것과 같아야 합니다.
 */
export type TimelineOccludeKeyRef = {
  kind: "occlude";
  trackId: string;
  keyId: string;
};

/**
 * 타임라인의 **방 줄**과 그 아래 «면 · 소품 투시» 속성 줄.
 *
 *
 *
 * 2026-09-17 에 `MoveTimeline` 에서 떼어 냈습니다 — 3,400줄 한 컴포넌트에서 «방 줄이 어디더라» 를
 * 찾는 데 시간이 더 걸렸습니다. 값을 계산하는 일(시각·비율·끌기)은 여전히 부모 하나가 하고,
 * 여기는 **그리는 일만** 합니다.
 */
export function TimelineRoomRows({
  state,
  setState,
  playhead,
  span,
  gutter,
  ratioOf,
  timeAt,
  dragKey,
  pickedKey,
  openLayers,
  closedLayers,
  toggleLayerOpen,
  sortByTime,
}: {
  state: CompositionState;
  /** 상태 고치기 — **늘 «지금 값을 받아 다음 값을 만드는 함수»** 입니다(CLAUDE.md). */
  setState: UpdateComposition;
  playhead: number;
  /** 타임라인 전체 길이(초). */
  span: number;
  /** 왼쪽 이름칸 너비(px) — 다른 줄과 자를 맞춥니다. */
  gutter: number;
  ratioOf: (seconds: number) => number;
  timeAt: (clientX: number) => number;
  dragKey: (
    key: TimelineOccludeKeyRef,
    timeAt: (clientX: number) => number,
  ) => (event: React.PointerEvent) => void;
  pickedKey: { kind: string; keyId: string } | null;
  openLayers: Set<string>;
  closedLayers: Set<string>;
  toggleLayerOpen: (id: string, isOpen: boolean) => void;
  /** 키를 시각 순으로 — 부모의 것을 그대로 씁니다(같은 규칙이어야 줄끼리 어긋나지 않습니다). */
  sortByTime: <T extends { id: string; time: number }>(keys: readonly T[]) => T[];
}) {
  const t = useT();
  // 이름 칸 너비는 부모가 정하고(`gutter`), 붙이는 방식은 공용 스타일이 정합니다.
  void gutter;
  return (
    <>
        {/*
          ── 방 레이어 — 면은 **속성 줄** ──────────────────────────────────
          

          처음엔 «회합방 오른쪽», «은신처 오른쪽», «회합방 왼쪽» … 을 각각 한 줄로 늘어놓고
          위에 면 단추 줄을 따로 뒀습니다. 그러면 방이 늘수록 줄이 뒤섞이고, 면 단추가
          어느 방 것인지 따로 골라야 했습니다(드롭다운 → 이름 클릭). 인물 레이어(▸ 이동·
          회전·크기)와 **같은 모양**으로 묶으면 둘 다 사라집니다 — 속성 줄마다 자기 단추가
          있으니 «어느 방» 을 고를 일 자체가 없습니다.

          방은 두셋뿐이라 **전부** 늘어놓습니다(키가 없는 방도 첫 키를 여기서 찍어야 하니까요).
          키가 있는 방만 펴 둡니다.
        */}
        {/*
          호리존 방도 **줄은 있습니다** — «가릴 면» 은 없지만(단색 벽뿐) 그 안에 세운 제품(소품)의
          «투시» 키는 여기서 찍습니다. 방 갈래로 줄을 통째로 빼면 스튜디오의 소품만 타임라인에서 사라집니다(규칙 1).
          여섯 면 줄만 아래에서 뺍니다.
        */}
        {roomsOf(state).length > 0 && (
          <div
            data-tour="bottom-room-rows"
            className="flex items-center gap-1 pt-1 text-[8px] font-semibold"
            style={{ color: "oklch(0.50 0.01 265)" }}
          >
            <span style={gutterStyle}>{t("방 · 가릴 면 · 소품")}</span>
            <span className="h-px flex-1" style={{ background: "oklch(1 0 0 / 8%)" }} />
          </div>
        )}
        {roomsOf(state).map((room) => {
          const color = "oklch(0.78 0.14 30)";
          const layerKey = `room:${room.id}`;
          const roomTracks = occludeTracksOf(state).filter((track) => track.roomId === room.id);
          // 인물 레이어와 같은 약속 — 기본은 닫힘, ▸ 로 엽니다.
          const open = openLayers.has(layerKey) && !closedLayers.has(layerKey);
          const horizon = !!room.horizon;
          const objects = objectsInRoom(state, room.id);
          return (
            <div key={room.id}>
              <div className="flex items-center">
                <div className="flex shrink-0 items-center gap-0.5" style={gutterStyle}>
                  <button
                    type="button"
                    onClick={() => toggleLayerOpen(layerKey, open)}
                    title={
                      open
                        ? horizon
                          ? "소품 줄 접기"
                          : "면 줄 접기"
                        : horizon
                          ? "소품 줄 펴기 — 호리존은 가릴 면이 없고, 이 방에 세운 소품의 투시만 있습니다"
                          : "면 줄 펴기 — 정면·후면·왼쪽·오른쪽·천장·바닥"
                    }
                    className="shrink-0 rounded p-1 hover:bg-white/5"
                    style={{ color: "oklch(0.70 0.01 265)" }}
                  >
                    {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: color }} />
                  <span
                    className="min-w-0 flex-1 truncate text-[9px] font-semibold"
                    style={{ color: "oklch(0.78 0.01 265)" }}
                    title={`${room.name || "방"} — ${room.width.toFixed(1)}×${room.depth.toFixed(1)}×${room.height.toFixed(1)}m · 가림 키가 있는 면 ${roomTracks.length}개`}
                  >
                    {room.name || "방"}
                  </span>
                </div>
                <div className="relative h-5 flex-1">
                  {/* 방은 컷 내내 서 있습니다 — 막대는 «이 방의 줄» 이라는 표시일 뿐 끌리지 않습니다. */}
                  <div
                    className="absolute inset-y-0 left-0 right-0 flex items-center rounded px-2 text-[9px] font-semibold"
                    style={{
                      background: `color-mix(in oklch, ${color} 14%, transparent)`,
                      border: "1px solid oklch(1 0 0 / 8%)",
                      color: "oklch(0.86 0.04 30)",
                    }}
                  >
                    <span className="truncate">{room.name || "방"}</span>
                  </div>
                </div>
              </div>
              {/* 여섯 면 줄 — 호리존은 뺍니다(단색 벽이라 가릴 면이 없고, 찍을 키도 없습니다). */}
              {open &&
                !horizon &&
                COMPOSITION_CUBE_FACES.map((face: CompositionCubeFace) => {
                  const track = roomTracks.find((item) => item.face === face);
                  const on = occludeAtIn(state, room.id, face, playhead);
                  const sorted = sortByTime(track?.keys ?? []);
                  const edges = [0, ...sorted.map((key) => key.time), span];
                  // 칠할 구간 — 경계마다 그 시각 값을 보고 «가리는» 구간만 막대로.
                  const spans = track
                    ? edges.slice(0, -1).flatMap((from, index) => {
                        const to = edges[index + 1];
                        if (to - from < 0.001) return [];
                        return occludeAtIn(state, room.id, face, from + 0.0005) ? [{ from, to }] : [];
                      })
                    : [];
                  const label = CUBE_FACE_LABELS[face];
                  return (
                    <div key={face} className="flex items-center">
                      <div className="flex shrink-0 items-center gap-0.5" style={gutterStyle}>
                        <span
                          className="min-w-0 flex-1 truncate pl-3 text-[8px] font-semibold"
                          style={{ color: track ? color : "oklch(0.50 0.01 265)" }}
                          title={`${room.name || "방"} 의 ${label} — 칠한 구간에만 뒤를 가립니다${track ? "" : ` · 키가 없어 환경 탭 체크(${on ? "가림" : "안 가림"})를 따릅니다`}`}
                        >
                          ↳ {label}
                        </span>
                        {/*
                          지금 시각의 상태를 보여 주고, 누르면 **이 시각부터 뒤집는** 키를 찍습니다.
                          인물 속성 줄의 「+」 자리 — 가림은 값이 둘뿐이라 «+» 대신 켜짐/꺼짐 표시.
                        */}
                        <button
                          type="button"
                          onClick={() =>
                            setState((current) => toggleOccludeKeyIn(current, room.id, face, playhead))
                          }
                          title={
                            on
                              ? `${playhead.toFixed(2)}초부터 ${label} 벽이 뒤를 가리지 않게 합니다`
                              : `${playhead.toFixed(2)}초부터 ${label} 벽이 뒤를 가리게 합니다`
                          }
                          className="shrink-0 rounded px-1 text-[8px] font-semibold"
                          style={{
                            background: on ? `color-mix(in oklch, ${color} 30%, transparent)` : "oklch(1 0 0 / 5%)",
                            color: on ? color : "oklch(0.52 0.01 265)",
                            border: `1px solid ${on ? color : "oklch(1 0 0 / 8%)"}`,
                          }}
                        >
                          {on ? "가림" : "열림"}
                        </button>
                      </div>
                      <div className="relative h-3.5 flex-1">
                        {spans.map((item) => (
                          <span
                            key={`${item.from}-${item.to}`}
                            className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-sm"
                            style={{
                              left: `${ratioOf(item.from) * 100}%`,
                              width: `${(ratioOf(item.to) - ratioOf(item.from)) * 100}%`,
                              background: `color-mix(in oklch, ${color} 38%, transparent)`,
                            }}
                          />
                        ))}
                        {sorted.map((key) => {
                          const picked = pickedKey?.kind === "occlude" && pickedKey.keyId === key.id;
                          return (
                            <span
                              key={key.id}
                              onPointerDown={dragKey({ kind: "occlude", trackId: track!.id, keyId: key.id }, timeAt)}
                              title={`${room.name || "방"} ${label} · ${key.time.toFixed(2)}초부터 ${key.on ? "가림" : "안 가림"} — 끌어서 옮기고, 눌러 고른 뒤 Delete 로 지웁니다`}
                              className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center"
                              style={{ left: `${ratioOf(key.time) * 100}%`, width: 20, height: 18, zIndex: 5 }}
                            >
                              <span
                                className="h-2.5 w-2.5 rounded-[2px]"
                                style={{
                                  // 가림은 꽉 찬 네모, 풀림은 빈 네모 — 색만으로는 안 갈립니다.
                                  background: picked ? "oklch(0.98 0.06 90)" : key.on ? color : "oklch(0.18 0.01 265)",
                                  border: `1.5px solid ${picked ? "oklch(0.98 0 0)" : color}`,
                                }}
                              />
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              {/*
                ── 이 방의 소품 · 투시 ──────────────────────────────────
                 방 면 줄과 **같은 모양**입니다 — 가리는 것이 면이냐 소품이냐만 다릅니다.
              */}
              {/* 호리존은 면 줄이 없어 소품이 없으면 펼쳐도 텅 빕니다 — «왜 비었나» 를 한 줄로. */}
              {open && horizon && objects.length === 0 && (
                <div className="flex items-center">
                  <span
                    className="min-w-0 truncate pl-3 text-[8px]"
                    style={{ ...gutterStyle, color: "oklch(0.50 0.01 265)" }}
                    title="호리존은 가릴 면이 없습니다. 환경 탭 «이 방의 소품» 으로 제품을 세우면 그 투시 줄이 여기 생깁니다"
                  >
                    ↳ 소품 없음
                  </span>
                </div>
              )}
              {open &&
                objects.map((object) => {
                  const track = occludeTracksOf(state).find(
                    (item) => item.objectId === object.id,
                  );
                  const on = objectSeeThroughAtIn(state, object.id, playhead);
                  const sorted = sortByTime(track?.keys ?? []);
                  const edges = [0, ...sorted.map((key) => key.time), span];
                  // 칠할 구간 — 경계마다 그 시각 값을 보고 «비치는» 구간만 막대로.
                  const spans = track
                    ? edges.slice(0, -1).flatMap((from, index) => {
                        const to = edges[index + 1];
                        if (to - from < 0.001) return [];
                        return objectSeeThroughAtIn(state, object.id, from + 0.0005)
                          ? [{ from, to }]
                          : [];
                      })
                    : [];
                  return (
                    <div key={object.id} className="flex items-center">
                      <div className="flex shrink-0 items-center gap-0.5" style={gutterStyle}>
                        <span
                          className="min-w-0 flex-1 truncate pl-3 text-[8px] font-semibold"
                          style={{ color: track ? color : "oklch(0.50 0.01 265)" }}
                          title={`${object.label} — 칠한 구간에만 비쳐 보입니다${track ? "" : ` · 키가 없어 환경 탭 «투시»(${on ? "투시" : "막음"})를 따릅니다`}`}
                        >
                          ↳ {object.label}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setState((current) =>
                              toggleObjectSeeThroughKeyIn(current, object.id, playhead),
                            )
                          }
                          title={
                            on
                              ? `${playhead.toFixed(2)}초부터 «${object.label}» 이 뒤를 가리게 합니다`
                              : `${playhead.toFixed(2)}초부터 «${object.label}» 이 비쳐 보이게 합니다`
                          }
                          className="shrink-0 rounded px-1 text-[8px] font-semibold"
                          style={{
                            background: on ? `color-mix(in oklch, ${color} 30%, transparent)` : "oklch(1 0 0 / 5%)",
                            color: on ? color : "oklch(0.52 0.01 265)",
                            border: `1px solid ${on ? color : "oklch(1 0 0 / 8%)"}`,
                          }}
                        >
                          {on ? "투시" : "막음"}
                        </button>
                      </div>
                      <div className="relative h-3.5 flex-1">
                        {spans.map((item) => (
                          <span
                            key={`${item.from}-${item.to}`}
                            className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-sm"
                            style={{
                              left: `${ratioOf(item.from) * 100}%`,
                              width: `${(ratioOf(item.to) - ratioOf(item.from)) * 100}%`,
                              background: `color-mix(in oklch, ${color} 38%, transparent)`,
                            }}
                          />
                        ))}
                        {sorted.map((key) => {
                          const picked = pickedKey?.kind === "occlude" && pickedKey.keyId === key.id;
                          return (
                            <span
                              key={key.id}
                              onPointerDown={dragKey({ kind: "occlude", trackId: track!.id, keyId: key.id }, timeAt)}
                              title={`${object.label} · ${key.time.toFixed(2)}초부터 ${key.on ? "투시" : "막음"} — 끌어서 옮기고, 눌러 고른 뒤 Delete 로 지웁니다`}
                              className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center"
                              style={{ left: `${ratioOf(key.time) * 100}%`, width: 20, height: 18, zIndex: 5 }}
                            >
                              <span
                                className="h-2.5 w-2.5 rounded-[2px]"
                                style={{
                                  background: picked ? "oklch(0.98 0.06 90)" : key.on ? color : "oklch(0.18 0.01 265)",
                                  border: `1.5px solid ${picked ? "oklch(0.98 0 0)" : color}`,
                                }}
                              />
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          );
        })}
    </>
  );
}

export default TimelineRoomRows;
