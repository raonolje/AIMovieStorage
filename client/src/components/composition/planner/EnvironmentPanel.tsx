import { HOLDS_ENTITY_CARD } from "@/lib/useTutorialPanel";
import { useState, type DragEvent } from "react";
import PlannerRange from "@/components/composition/planner/PlannerRange";
import { Grid3X3, X } from "lucide-react";
import { NumberInput, PanelSection } from "@/components/composition/fields";
import {
  COMPOSITION_CUBE_FACES,
  CUBE_FACE_LABELS,
  HORIZON_COLOR_PRESETS,
  ROOM_DRIFT_MAX,
  ROOM_SIZE_MIN,
  ROOM_VIDEO_SECONDS,
  isDomeRoom,
  isHorizonRoom,
  isPanoramaAspect,
  roomDriftOf,
  roomVideoFaceOf,
  type CompositionCubeFace,
  type CompositionRoom,
  type CompositionState,
  type RoomVideoFace,
} from "@/lib/composition";
import LocalGenerateButton from "@/components/LocalGenerateButton";
import { safeFileName } from "@/lib/mediaLibrary";
import type { LocalPromptInput } from "@/lib/localPrompt";
import {
  addObjectInRoom,
  mountObjectToFaceIn,
  objectGroupOf,
  objectsInRoom,
  patchRoomIn,
  roomsOf,
  setObjectSwapIn,
  setRoomDimsIn,
  setRoomHorizonColorIn,
  setRoomPanoramaIn,
  setOutdoorShapeIn,
  setFaceOccludesIn,
  updateObjectIn,
  type UpdateComposition,
} from "@/lib/compositionEdit";
import { OBJECT_KINDS, SWAPPABLE_KINDS } from "./objectKinds";
import { ObjectList } from "./ObjectList";
import { ObjectFields } from "./ObjectFields";
import { GroupCards } from "./ObjectGroupPanel";
import FaceSetCard from "@/components/FaceSetCard";
import RoomList from "./RoomList";
import type { FaceSet } from "@/lib/faceSets";
import type { RoomPreset } from "@/lib/roomPreset";
import type { PlannerBackground, PlannerVideo } from "./usePlannerMedia";
import type { SectionToggles } from "./PlannerChrome";

/**
 * 환경 탭 — **방을 세우고, 방마다 그 속성**.
 *
 * # 2026-09-16 개편
 *
 * ,
 * 「실외에는 뒤를 가릴 면이 필요 없잖아? 그리고 실내도… 공간마다 뒤를 가릴 면을 선택하는 거고」,
 * 「6면 세트의 경우 실내 방의 속성으로 들어가야 하고, 6면 적용하는 건 지금은 큰 의미 없는 것 같아… 삭제해」,
 * 「배경 이미지 목록도 지금은 필요 없겠네… 파노라마 이미지 리스트는 실외 방의 속성으로 들어가면 될 거고」.
 *
 * 그래서 이 탭에는 **목록 하나**만 있습니다 — 방 목록. 방을 누르면 그 아래가 펴지고, 그 방의 것만 나옵니다.
 *
 * 실내 방 : 치수 · 뒤를 가릴 면 · 외벽 투시 · 장소(전개도 만들기) · 6면 세트
 * 실외 방 : 치수 · 장소(파노라마 만들기) · 파노라마 그림 목록
 * 호리존 : 치수 · 호리존 색
 *
 * 세 갈래 모두 그 아래에 «이 방의 소품» 이 옵니다 — 호리존의 제품도 소품입니다.
 *
 * 걷어낸 것: 면 하나하나 고르기(«여섯 면»), 안쪽/바깥쪽 토글(세트 이름이 정합니다), 배경 이미지 목록.
 * 한 컷에 필요한 배경은 대개 «정면 한 장» 이라 **배치 탭의 «벽»** 이 그 자리를 대신합니다.
 */
/** 이 창을 열면 생기는 자리들 — 장소 카드 몸통과 그 안의 가위(전개도·파노라마) 전부. */
const PLACE_LIBRARY_OPENS = HOLDS_ENTITY_CARD;

/**
 * **배경 루프 영상 프롬프트** — 그 면 그림이 «살아 있는» 짧은 루프가 되게 적습니다.
 *
 * 장소 카드의 프롬프트를 바탕에 깔고(그 배경이 무엇인지는 거기 다 적혀 있습니다) 뒤에 «무엇이
 * 움직이는가» 만 덧붙입니다. 카메라는 **못 박습니다** — 배경 영상이 흔들리면 그 면만 흔들려
 * 방이 통째로 미끄러지고, 구도잡기의 카메라 무빙과 섞여 무엇이 움직인 것인지 알 수 없게 됩니다.
 *
 * 함수인 까닭: 방 이름·면·장소 프롬프트가 그때그때 다릅니다. 모듈 상수로 굳히면 방을 바꿔도
 * 앞 방의 말이 그대로 갑니다.
 */
function backgroundLoopPrompt(
  place: { ko?: string; en?: string } | undefined,
  roomName: string,
  face: RoomVideoFace,
): LocalPromptInput {
  const where = face === "panorama" ? "파노라마 돔" : `${CUBE_FACE_LABELS[face]} 벽`;
  const whereEn = face === "panorama" ? "panoramic dome" : `${face} wall`;
  return {
    ko: [
      place?.ko?.trim(),
      `이 그림을 첫 프레임으로 두고, ${roomName || "방"} 의 ${where}에 걸 ${ROOM_VIDEO_SECONDS}초짜리 배경 루프를 만드세요.`,
      "카메라는 삼각대에 올린 듯 완전히 고정합니다 — 흔들림·줌·패닝·시점 이동 없음.",
      "움직이는 것은 배경 자체뿐입니다: 멀리 지나가는 사람과 차, 흔들리는 나뭇잎·천·간판, 흐르는 구름과 물, 깜빡이는 조명, 피어오르는 김과 먼지, 천천히 변하는 그림자.",
      "구도·색·빛·원근은 첫 프레임 그대로 지키고, 마지막 프레임이 첫 프레임으로 자연스럽게 이어지게 합니다.",
      "새 물체나 글자를 만들지 말고, 장면 전환 없이 한 장면으로 갑니다.",
    ]
      .filter(Boolean)
      .join("\n"),
    en: [
      place?.en?.trim(),
      `Use this image as the first frame and make a ${ROOM_VIDEO_SECONDS}-second seamless background loop for the ${whereEn}.`,
      "Locked-off tripod camera: no camera movement, no zoom, no pan, no parallax.",
      "Only the scene itself moves: distant people and vehicles passing, leaves and fabric and signs swaying, clouds and water flowing, lights flickering, steam and dust drifting, shadows creeping.",
      "Keep the composition, colours, lighting and perspective of the first frame; the last frame must blend back into the first.",
      "Do not invent new objects or text, and do not cut to another shot.",
    ]
      .filter(Boolean)
      .join("\n"),
    negativeKo: "카메라 움직임, 줌, 흔들림, 장면 전환, 글자, 새 물체, 색 변화",
    negativeEn: "camera movement, zoom, shake, scene cut, text, new objects, colour shift",
  };
}

export interface EnvironmentPanelProps extends SectionToggles {
  state: CompositionState;
  setState: UpdateComposition;
  /** 6면 세트의 낱장을 뺀 목록 — 실외 방의 «파노라마 그림» 도 여기서 고릅니다. */
  listedBackgrounds: PlannerBackground[];
  faceSets: FaceSet<PlannerBackground>[];
  /** 세트 하나를 여섯 면에 한 번에. 빠진 면은 비웁니다. */
  assignFaceSet: (set: FaceSet<PlannerBackground>) => void;
  /** 그림 한 장을 활성 방의 파노라마 돔으로(크기는 그 카드의 프롬프트에서). */
  assignPanorama: (background: PlannerBackground) => void;
  /**
   * 파노라마 파일을 **바깥에서 바로** 들여옵니다(고르기 또는 끌어다 놓기).
   *
   * 여태는 앱에서 뽑은 것만 목록에 올랐습니다. 밖에서 만든 360° 사진
   * (블록케이드 스카이박스·실촬 360)을 쓸 길이 없었습니다.
   */
  onImportPanorama?: (file: File) => void | Promise<void>;
  /**
   * 목록에서 파노라마 한 장을 **지웁니다**().
   * 폴더의 원본 파일도 함께 지웁니다 — 이 앱의 규칙이고, 안 지우면 폴더를 다시 읽을 때 되살아납니다.
   */
  onDeletePanorama?: (background: PlannerBackground) => void | Promise<void>;
  isFaceSetAssigned: (set: FaceSet<PlannerBackground>) => boolean;
  /**
   * 이 방의 크기로 **장소 카드**를 만들고 그 카드를 바로 엽니다.
   * 안 주면 칸이 안 보입니다(구도잡기를 프로젝트 밖에서 열었을 때).
   */
  onCreatePlace?: (spec: {
    kind: "outdoor" | "dome" | "roomInner" | "roomOuter";
    name: string;
    width: number;
    depth: number;
    height: number;
  }) => void;
  /** 이 방에 이어 둔 장소 카드를 창으로 엽니다. */
  onOpenPlace?: () => void;
  /** 이어 둔 장소 카드의 이름. */
  placeName?: string | null;
  /**
   * 프로젝트에 이미 있는 **장소 카드 목록**과 그중 하나를 이 방에 잇는 길.
   *
   * * 고른 뒤에도 목록은 그대로 있고, 빈 칸을 고르면 이음을 끊습니다.
   */
  places?: { id: string; name: string }[];
  onPickPlace?: (backgroundId: string) => void;
  /** 저장해 둔 방 라이브러리. 안 주면 칸이 안 보입니다. */
  roomLibrary?: {
    presets: RoomPreset[];
    save: () => void;
    apply: (preset: RoomPreset) => void;
    remove: (id: string) => void;
    /**
     * **다른 작품에서 방 끌어오기** 를 여는 자리. 안 주면 단추가 안 보입니다.
     *
     *
     */
    borrow?: () => void;
  };
  /** 그림을 큰 화면으로 훑어보는 창(면에 직접 붙이고 싶을 때). */
  onOpenGallery: () => void;
  /**
   * **장소 라이브러리**(옛 배경 단계) 열기 — 계보(관계도)·보유 에셋을 봅니다.
   *
   */
  onOpenLibrary?: () => void;
  /**
   * **배경 소품**에 이어 붙일 시트들(에셋만) — 소품을 «무엇으로 바꿔 그릴까» 에 씁니다.
   *
   * , 「그래야 소품 에셋이랑 배치한 소품도 매칭시킬 수 있고… 프롬프트 작성할 때 @로 링크 걸어 주기도 편할 거고」.
   */
  assetOptions?: { kind: "character" | "asset" | "background"; id: string; name: string; group: string }[];
  /** 고른 소품의 에셋 카드를 만들어 바로 잇거나, 이미 이어 둔 카드를 엽니다. */
  onCreateAsset?: (objectId: string, label: string) => void;
  /** 묶음(덩어리) 쪽 에셋.  */
  onCreateGroupAsset?: (groupId: string, label: string) => void;
  /** 3D 화면에서 그 소품을 고릅니다(«object:<id>»). */
  selected?: string;
  setSelected?: (value: string) => void;
  /**
   * **배경 영상** 한 벌 — 고를 목록, 그 면 그림으로 만들 자리, 만든 것을 목록에 더하는 길.
   *
   * 안 주면 «배경 영상» 칸 자체가 안 보입니다(구도잡기를 프로젝트 밖에서 열었을 때) — 걸 영상도
   * 만들 폴더도 없는 자리에 켜기만 하는 단추를 두면 «켰는데 아무 일도 안 일어난다» 가 됩니다.
   */
  roomVideo?: {
    /** 장소 폴더에서 읽은 영상들. 이 방뿐 아니라 이 작품의 장소 전부입니다(같은 루프를 두 방에 걸 수 있게). */
    videos: PlannerVideo[];
    projectName: string;
    /** 만든 영상을 넣을 폴더의 주인 — 이 방에 이어 둔 **장소 카드 이름**(규칙 5: 폴더는 인물·장소당 하나). */
    ownerName?: string | null;
    /** 그 장소 카드의 프롬프트 — 「이 배경이 이렇게 움직인다」 를 적을 바탕입니다. */
    prompt?: { ko?: string; en?: string };
    /** 방금 만든 영상을 목록에 더합니다(폴더는 창을 열 때만 읽습니다). */
    remember: (filePath: string, name: string) => void;
    /** 그 면에 걸린 그림의 **파일 경로** — i2v 의 첫 프레임입니다. */
    faceImagePath: (roomId: string, face: RoomVideoFace) => string | undefined;
  };
  /** 되돌리기에 **안 쌓는** 갱신 — 손잡이를 끄는 동안 씁니다. 까닭은 `PlannerRange`. */
  setStateRaw: UpdateComposition;
  mark: () => void;
}

export function EnvironmentPanel({
  state,
  setState,
  listedBackgrounds,
  faceSets,
  assignFaceSet,
  assignPanorama,
  onImportPanorama,
  onDeletePanorama,
  isFaceSetAssigned,
  onCreatePlace,
  onOpenPlace,
  placeName,
  places,
  onPickPlace,
  roomLibrary,
  onOpenGallery,
  onOpenLibrary,
  assetOptions,
  onCreateAsset,
  onCreateGroupAsset,
  selected,
  setSelected,
  roomVideo,
  openSections,
  toggleSection,
  setStateRaw,
  mark,
}: EnvironmentPanelProps) {
  const rooms = roomsOf(state);

  return (
    <div className="space-y-3">
      {/*
        앵커는 PanelSection 의 `tour` 로 넘깁니다 — 뿌리 <section> 에 달려야 방이 하나도 없을 때도
        머리줄을 잡을 수 있습니다. 여기 open 은 늘 참이라 접혀서 앵커가 사라질 일은 없습니다.
      */}
      <PanelSection title="방" tour="env-room-section" open onToggle={() => undefined}>
        {/*
          방은 **처음에 없습니다**().
          목록에서 방을 누르면 그 아래가 펴지고, 거기부터가 그 방의 속성입니다.
        */}
        <RoomList
          state={state}
          setState={setState}
          renderProperties={(room) => (
            <RoomProperties
              room={room}
              state={state}
              setState={setState}
              listedBackgrounds={listedBackgrounds}
              faceSets={faceSets}
              assignFaceSet={assignFaceSet}
              assignPanorama={assignPanorama}
              onImportPanorama={onImportPanorama}
              onDeletePanorama={onDeletePanorama}
              isFaceSetAssigned={isFaceSetAssigned}
              onCreatePlace={onCreatePlace}
              onOpenPlace={onOpenPlace}
              placeName={placeName}
              places={places}
              onPickPlace={onPickPlace}
              onOpenGallery={onOpenGallery}
              assetOptions={assetOptions}
              onCreateAsset={onCreateAsset}
              onCreateGroupAsset={onCreateGroupAsset}
              selected={selected}
              setSelected={setSelected}
              roomVideo={roomVideo}
              setStateRaw={setStateRaw}
              mark={mark}
            />
          )}
        />

        {rooms.length === 0 && (
          <p className="mt-2 text-[9px] leading-relaxed" style={{ color: "oklch(0.48 0.01 265)" }}>
            아직 방이 없습니다 — <b>구도만 잡는 컷</b>입니다. 위의 «실내»·«실외» 로 방을 세우면 여섯 면이 아직 없는 빈 방이
            생기고, 인물을 놓아 크기를 견주며 치수를 정한 뒤 그 치수로 이미지를 뽑습니다. «호리존» 은 그림 없이 색 하나로
            잇는 제품 컷 스튜디오입니다. 배경이 한쪽만 필요하면 방 대신 <b>배치 탭의 «벽»</b> 이 더 빠릅니다.
          </p>
        )}
      </PanelSection>

      {/*
        ── 장소 라이브러리 ───────────────────────────────────────────────
         장소를 **만드는** 일은 방 속성에서 하고, 목록 전체를 봐야 하는 일
        (계보·다른 원본·보유 에셋)은 여기서 창으로 엽니다 — 씬 탭에 있던 그 화면 그대로입니다.
      */}
      {onOpenLibrary && (
        <button
          type="button"
          onClick={onOpenLibrary}
          /*
            **장소 카드는 이 창 안에 있습니다.**
            전개도 여섯 면·파노라마·앵커 찍기·표시하기는 장소 그림에서 하는 일인데, 그 카드로 가는
            길이 여기 하나뿐이라 안내 창이 먼저 이 문을 눌러 줍니다.
          */
          data-tour-open={PLACE_LIBRARY_OPENS}
          className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold"
          style={{
            background: "oklch(0.62 0.22 290 / 14%)",
            border: "1px solid oklch(0.62 0.22 290 / 36%)",
            color: "oklch(0.84 0.16 290)",
          }}
        >
          <Grid3X3 className="h-3 w-3" /> 장소 라이브러리 — 관계도 · 보유 에셋
        </button>
      )}

      {/*
        ── 방 라이브러리 ─────────────────────────────────────────────────
        같은 장소가 씬마다 다시 나옵니다. 방을 통째로(치수·여섯 면·그 안의 소품과 묶음·이어 둔 에셋) 담아 두고 다음 컷에서
        꺼내 세웁니다. 소품 자리는 **방 기준**으로 담겨 방을 다른 자리에 세워도 안의 것이 따라옵니다(`lib/roomPreset.ts`).
      */}
      {roomLibrary && (
        <PanelSection
          tour="env-room-library"
          title="방 라이브러리"
          count={roomLibrary.presets.length}
          open={openSections.roomLibrary ?? false}
          onToggle={() => toggleSection("roomLibrary")}
        >
          {/*
            목록은 **이 작품 것만** 입니다(`draft.roomPresets`) —  다른 작품 것은 이 단추로 **복사해** 들여옵니다.
          */}
          {roomLibrary.borrow && (
            <button
              type="button"
              onClick={roomLibrary.borrow}
              className="mb-1.5 w-full rounded-md px-2 py-1.5 text-[10px] font-semibold"
              style={{
                background: "oklch(0.55 0.15 200 / 14%)",
                border: "1px dashed oklch(0.55 0.15 200 / 34%)",
                color: "oklch(0.78 0.12 200)",
              }}
            >
              다른 작품에서 방 끌어오기
            </button>
          )}
          {rooms.length > 0 && (
            <button
              type="button"
              onClick={roomLibrary.save}
              className="w-full rounded-md px-2 py-1.5 text-[10px] font-semibold"
              style={{
                background: "oklch(0.78 0.14 30 / 16%)",
                border: "1px solid oklch(0.78 0.14 30 / 40%)",
                color: "oklch(0.86 0.12 30)",
              }}
            >
              지금 방 저장 — 방 + 안의 소품까지
            </button>
          )}
          {roomLibrary.presets.length === 0 ? (
            <p className="mt-1.5 text-[9px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
              아직 없습니다. 방을 세우고 소품을 놓은 뒤 저장하면, 다른 컷에서 그대로 꺼내 씁니다.
            </p>
          ) : (
            <div className="composition-scroll mt-1.5 max-h-40 space-y-1 overflow-y-auto pr-1">
              {roomLibrary.presets.map((preset) => (
                <div key={preset.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => roomLibrary.apply(preset)}
                    title={`${preset.room.width.toFixed(1)} × ${preset.room.depth.toFixed(1)} × ${preset.room.height.toFixed(1)} m · 소품 ${preset.objects.length}개 — 누르면 새 방으로 세웁니다`}
                    className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-[10px]"
                    style={{ background: "oklch(1 0 0 / 5%)", color: "oklch(0.80 0.01 265)" }}
                  >
                    {preset.name}
                    <span className="ml-1 text-[9px]" style={{ color: "oklch(0.50 0.01 265)" }}>
                      {preset.room.width.toFixed(1)}×{preset.room.depth.toFixed(1)}×
                      {preset.room.height.toFixed(1)}m
                      {preset.objects.length ? ` · 소품 ${preset.objects.length}` : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => roomLibrary.remove(preset.id)}
                    aria-label="라이브러리에서 지우기"
                    title="라이브러리에서만 지웁니다 — 세워 둔 방과 그림 파일은 그대로입니다"
                    className="shrink-0 rounded p-1 hover:bg-white/10"
                    style={{ color: "oklch(0.60 0.15 25)" }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </PanelSection>
      )}

      <PanelSection tour="env-display" title="화면" open onToggle={() => undefined}>
        <label className="flex items-center gap-2 text-[10px]" style={{ color: "oklch(0.62 0.01 265)" }}>
          <input
            type="checkbox"
            checked={state.showLabels}
            onChange={(event) =>
              setState((current) => ({ ...current, showLabels: event.target.checked }))
            }
          />
          이름표 — 캡처·영상에는 나오지 않습니다
        </label>
        <label
          className="mt-1.5 flex items-center gap-2 text-[10px]"
          style={{ color: "oklch(0.62 0.01 265)" }}
        >
          <input
            type="checkbox"
            checked={state.showCharacterPaths}
            onChange={(event) =>
              setState((current) => ({ ...current, showCharacterPaths: event.target.checked }))
            }
          />
          인물 동선
        </label>

        {/* 조명을 하나도 안 켰는데 배경만 환하면 인물이 배경 위에 오려 붙인 것처럼 보입니다. */}
        {rooms.length > 0 && (
          <div className="mt-2 text-[10px]" style={{ color: "oklch(0.52 0.01 265)" }}>
            <span className="flex items-center justify-between">
              <span>배경 밝기 — 하늘 조명이 없을 때</span>
              <span className="tabular-nums">{state.skylessBrightness.toFixed(2)}</span>
            </span>
            <PlannerRange
              min={0.05}
              max={1}
              step={0.01}
              value={state.skylessBrightness}
              mark={mark}
              onChange={(next) =>
                setStateRaw((current) => ({ ...current, skylessBrightness: next }))
              }
              className="mt-1 w-full"
            />
          </div>
        )}
      </PanelSection>
    </div>
  );
}

/**
 * **배경 흐름의 네 방향** — 이름과 부호를 한 벌로 둡니다.
 *
 * 부호는 «그림이 움직여 보이는 쪽» 입니다. UV 오프셋은 **표집 창**을 옮기는 값이라 그림은
 * 반대로 흘러갑니다 — offset.x 를 키우면 창이 오른쪽으로 가고 그림은 왼쪽으로 지나갑니다
 * (세로도 같습니다. three 는 `flipY` 라 offset.y 가 커지면 그림이 아래로 내려갑니다).
 * 이 뒤집기를 화면과 뷰포트가 따로 셈하면 한쪽만 거꾸로 흐릅니다.
 *
 * 기준은 **정면 벽**입니다. 상자 안쪽은 옆 네 면의 uv 를 거울로 되돌려 붙이므로
 * (`buildBackgroundCubeGeometry`) 네 벽은 서로 같은 쪽으로 흐르고, 천장·바닥은 그 반대입니다 —
 * 「천장이 어느 쪽으로 흘러야 맞는가」 는 답이 없는 물음이라 그대로 둡니다.
 */
const ROOM_DRIFT_DIRECTIONS = [
  { id: "left", label: "왼쪽으로", x: 1, y: 0 },
  { id: "right", label: "오른쪽으로", x: -1, y: 0 },
  { id: "up", label: "위로", x: 0, y: -1 },
  { id: "down", label: "아래로", x: 0, y: 1 },
] as const;

/** 흐름을 처음 켤 때의 속도(초당 그림의 몇 배) — 20초에 한 바퀴. 차창 밖 풍경이 흐르는 느낌의 언저리입니다. */
const ROOM_DRIFT_DEFAULT_SPEED = 0.05;

/**
 * 방 하나의 속성 — **그 방 아래에** 펴집니다.
 *
 * 실내와 실외는 필요한 것이 다릅니다().
 * 실외는 돔이라 가릴 벽도, 여섯 면도 없습니다 — 파노라마 한 장이 전부입니다.
 * 호리존은 그림 자체가 없습니다 — 치수와 색 하나뿐입니다.
 */
function RoomProperties({
  room,
  state,
  setState,
  listedBackgrounds,
  faceSets,
  assignFaceSet,
  assignPanorama,
  onImportPanorama,
  onDeletePanorama,
  isFaceSetAssigned,
  onCreatePlace,
  onOpenPlace,
  placeName,
  places,
  onPickPlace,
  onOpenGallery,
  assetOptions,
  onCreateAsset,
  onCreateGroupAsset,
  selected,
  setSelected,
  roomVideo,
  setStateRaw,
  mark,
}: {
  room: CompositionRoom;
  state: CompositionState;
  setState: UpdateComposition;
  /** 되돌리기에 **안 쌓는** 갱신과 «지금 판 기록» — 색 고르기 창을 끄는 동안 씁니다(`PlannerRange` 와 같은 규칙). */
  setStateRaw: UpdateComposition;
  mark: () => void;
  listedBackgrounds: PlannerBackground[];
  faceSets: FaceSet<PlannerBackground>[];
  assignFaceSet: (set: FaceSet<PlannerBackground>) => void;
  assignPanorama: (background: PlannerBackground) => void;
  onImportPanorama?: EnvironmentPanelProps["onImportPanorama"];
  onDeletePanorama?: EnvironmentPanelProps["onDeletePanorama"];
  isFaceSetAssigned: (set: FaceSet<PlannerBackground>) => boolean;
  onCreatePlace?: EnvironmentPanelProps["onCreatePlace"];
  onOpenPlace?: () => void;
  placeName?: string | null;
  places?: { id: string; name: string }[];
  onPickPlace?: (backgroundId: string) => void;
  onOpenGallery: () => void;
  assetOptions?: EnvironmentPanelProps["assetOptions"];
  onCreateAsset?: (objectId: string, label: string) => void;
  onCreateGroupAsset?: (groupId: string, label: string) => void;
  selected?: string;
  setSelected?: (value: string) => void;
  roomVideo?: EnvironmentPanelProps["roomVideo"];
}) {
  const outdoor = room.outdoor === true;
  /**
   * **호리존**인가 — 그림을 안 붙이는 방. 장소·전개도·파노라마·6면 세트·가릴 면 칸이 전부 빠지고
   * 색 칸 하나가 들어옵니다. `boxLike` 에서도 빼야 «6면 세트» 가 안 뜹니다.
   */
  const horizon = isHorizonRoom(room);
  /**
   * 실외를 **무엇으로 두르는가**. 돔이면 파노라마 한 장, 상자면 여섯 면입니다.
   * 실내는 늘 상자입니다.
   */
  const domeLike = isDomeRoom(room);
  /** 파노라마를 끌어다 놓는 중인가 — 테두리로 «여기 놓으면 됩니다» 를 보입니다. */
  const [dropping, setDropping] = useState(false);
  /** 목록이 비어 있든 아니든 **이 칸 어디에나** 놓을 수 있게, 손잡이를 한 벌 만들어 씁니다. */
  const dropHandlers = onImportPanorama
    ? {
        onDragOver: (event: DragEvent) => {
          event.preventDefault();
          setDropping(true);
        },
        onDragLeave: () => setDropping(false),
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setDropping(false);
          const file = Array.from(event.dataTransfer.files).find((item) =>
            item.type.startsWith("image/"),
          );
          if (file) void onImportPanorama(file);
        },
      }
    : {};
  const boxLike = !domeLike && !horizon;
  /*
    ── 배경 흐름 ────────────────────────────────────────────────────────
    지금 걸린 값에서 «방향» 과 «속도» 를 되읽습니다. 저장은 {x, y} 한 쌍뿐이라
    (`CompositionRoom.drift`) 방향·속도를 따로 저장하지 않습니다 — 두 벌로 두면 손으로 고친
    저장본에서 둘이 어긋나고, 어느 쪽이 참인지 판단하는 규칙이 또 하나 늘어납니다.
  */
  const drift = roomDriftOf(room.drift);
  const driftSpeed = drift ? Math.max(Math.abs(drift.x), Math.abs(drift.y)) : ROOM_DRIFT_DEFAULT_SPEED;
  const driftDirection =
    ROOM_DRIFT_DIRECTIONS.find(
      (item) => Math.sign(drift?.x ?? 0) === item.x && Math.sign(drift?.y ?? 0) === item.y,
    ) ?? ROOM_DRIFT_DIRECTIONS[0];
  /** 방향 × 속도 → 저장할 {x, y}. 속도 0 이면 정규화가 «안 흐름» 으로 떨어뜨립니다. */
  const setDrift = (
    direction: (typeof ROOM_DRIFT_DIRECTIONS)[number],
    speed: number,
    raw = false,
  ) =>
    (raw ? setStateRaw : setState)((current) =>
      patchRoomIn(current, room.id, (item) => ({
        ...item,
        drift: roomDriftOf({ x: direction.x * speed, y: direction.y * speed }),
      })),
    );
  /*
    ── 배경 영상 ────────────────────────────────────────────────────────
    걸 자리는 **지금 방 모양**이 정합니다(`roomVideoFaceOf`) — 돔으로 바꾼 방에 옛 «정면» 이 남아
    있으면 안 보이는 면에 걸려 「켰는데 아무 일도 안 일어난다」 가 됩니다. 첫 프레임은 그 면에 걸린
    그림의 **파일 경로**입니다(로컬 생성기는 `asset://` 을 못 엽니다).
  */
  const videoFace = roomVideoFaceOf(room);
  const faceImage = roomVideo?.faceImagePath(room.id, videoFace);
  const assets = (assetOptions ?? []).filter((item) => item.kind === "asset");
  const panorama = room.panorama
    ? listedBackgrounds.find((item) => item.id === room.panorama)
    : null;
  /** 실외 방에 걸 수 있는 그림 — 2:1 등장방형만. 벽지·낱장을 걸면 돔이 우그러집니다. */
  const panoramas = listedBackgrounds.filter((item) => isPanoramaAspect(item.aspect));

  return (
    <div
      className="mt-1 space-y-2 rounded-md p-2"
      style={{ background: "oklch(1 0 0 / 3%)", border: "1px solid oklch(1 0 0 / 7%)" }}
    >
      {/*
        ── 치수를 먼저 정합니다 ────────────────────────────────────────
        이미지는 **이 숫자대로** 뽑힙니다(프롬프트에 미터가 박힙니다). 인물을 놓고 화면에서 공간 크기를 눈으로 본 다음
        여기서 확정하고 «만들기» 로 갑니다.
      */}
      {/*
        **돔은 구면이라 숫자가 하나입니다.** 가로·깊이·높이를 따로 받으면 셋이 어긋난 «찌그러진 돔» 을 만들 수 있는데, 화면에도 프롬프트에도
        그런 모양은 없습니다. 안에는 여전히 가로=깊이=지름, 높이=반지름으로 적어 둡니다 — 축척·인물 비율·저장본이
        전부 그 셋을 보고 돌아갑니다.
      */}
      {domeLike ? (
        <div data-tour="env-room-size" className="grid grid-cols-2 gap-1">
          <label className="text-[9px]" style={{ color: "oklch(0.55 0.01 265)" }}>
            반지름 (m)
            <NumberInput
              value={Math.round((room.width / 2) * 100) / 100}
              step={0.5}
              min={ROOM_SIZE_MIN}
              onChange={(next) =>
                setState((current) =>
                  setRoomDimsIn(
                    current,
                    { width: next * 2, depth: next * 2, height: next },
                    room.id,
                    true,
                  ),
                )
              }
            />
          </label>
          <p className="self-end text-[9px] leading-relaxed" style={{ color: "oklch(0.48 0.01 265)" }}>
            지름 {Math.round(room.width * 10) / 10} m · 꼭대기 {Math.round((room.width / 2) * 10) / 10} m
          </p>
        </div>
      ) : (
        <div data-tour="env-room-size" className="grid grid-cols-3 gap-1">
          {(
            [
              ["width", "가로", room.width],
              ["depth", "깊이", room.depth],
              ["height", outdoor ? "높이" : "층고", room.height],
            ] as const
          ).map(([key, label, value]) => (
            <label key={key} className="text-[9px]" style={{ color: "oklch(0.55 0.01 265)" }}>
              {label} (m)
              <NumberInput
                value={Math.round(value * 100) / 100}
                step={0.1}
                min={ROOM_SIZE_MIN}
                onChange={(next) =>
                  setState((current) => setRoomDimsIn(current, { [key]: next }, room.id, true))
                }
              />
            </label>
          ))}
        </div>
      )}
      <p className="text-[9px] leading-relaxed" style={{ color: "oklch(0.48 0.01 265)" }}>
        밑면이 바닥(y=0)이라 <b>인물이 뜨지 않습니다.</b> {domeLike ? "반지름" : outdoor ? "한 변" : "방 크기"}가 곧
        축척이에요 — 줄이면 인물이 차지하는 비율이 커져 배경보다 커 보입니다.
        {domeLike && " 파노라마의 지평선은 눈높이 1.6 m 에 옵니다."}
      </p>

      {/*
        ── 배경 흐름 ─────────────────────────────────────────────────────
        면·돔 그림이 정지 이미지면 레퍼런스 영상에 배경 움직임이 **한 프레임도 안 찍히고**,
        영상 모델은 그걸 그대로 따라 배경을 얼립니다. 차 안에서 창밖이 흘러야 하는 컷이
        특히 어색했습니다. 그림을 다시 뽑지 않고 그 사실만 영상에 남기는 길입니다.

        **기본은 꺼짐**입니다 — 쓰던 사람의 배경이 어느 날 갑자기 흐르면 놀랍니다.
        호리존은 그림이 아니라 색 하나라 흐를 것이 없어 칸 자체가 없습니다.

        속도 손잡이는 끄는 동안 `setStateRaw` 로 갑니다(까닭은 `PlannerRange` 머리말) —
        한 번의 끌기가 되돌리기 한 칸입니다.
      */}
      {!horizon && (
        <div data-tour="env-room-drift" className="space-y-1.5">
          <label
            className="flex cursor-pointer items-center gap-2 text-[9px] font-semibold"
            style={{ color: "oklch(0.52 0.01 265)" }}
            title="면·돔 그림을 흘립니다 — 레퍼런스 영상에도 그대로 찍힙니다"
          >
            <input
              type="checkbox"
              checked={!!drift}
              onChange={(event) =>
                setDrift(driftDirection, event.target.checked ? driftSpeed : 0)
              }
            />
            배경 흐름 — 그림을 흘려 배경을 움직입니다
          </label>
          {drift && (
            <>
              <div className="grid grid-cols-4 gap-1">
                {ROOM_DRIFT_DIRECTIONS.map((item) => {
                  const on = item.id === driftDirection.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setDrift(item, driftSpeed)}
                      className="rounded px-1 py-1 text-[9px] font-semibold"
                      style={{
                        background: on ? "oklch(0.72 0.16 60 / 22%)" : "oklch(1 0 0 / 5%)",
                        border: `1px solid ${on ? "oklch(0.72 0.16 60 / 45%)" : "transparent"}`,
                        color: on ? "oklch(0.86 0.14 60)" : "oklch(0.60 0.01 265)",
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <div className="text-[9px]" style={{ color: "oklch(0.52 0.01 265)" }}>
                <span className="flex items-center justify-between">
                  <span>속도 — 초당 그림의 몇 배</span>
                  <span className="tabular-nums">
                    {driftSpeed.toFixed(3)} · 한 바퀴 {Math.round(1 / driftSpeed)} 초
                  </span>
                </span>
                <PlannerRange
                  min={0.002}
                  max={ROOM_DRIFT_MAX}
                  step={0.002}
                  value={driftSpeed}
                  mark={mark}
                  onChange={(next) => setDrift(driftDirection, next, true)}
                  className="mt-1 w-full"
                  title="그림 한 장이 한 바퀴 지나가는 데 걸리는 시간으로 가늠하세요"
                />
              </div>
              <p className="text-[9px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
                재생·눈금 끌기·<b>레퍼런스 영상</b>에 모두 그 시각대로 찍힙니다. 그림이 한 장을 넘어가면 좌우가
                이어 붙으므로, 이음매가 안 맞는 사진은 느리게 두거나 «흐름» 을 켤 면만 남기는 편이 낫습니다.
                {boxLike && " 네 벽은 같은 쪽으로 흐르고 천장·바닥은 반대로 갑니다."}
              </p>
            </>
          )}
        </div>
      )}

      {/*
        ── 배경 영상 ─────────────────────────────────────────────────────
        **흐름과 별개의 단추입니다.** 흐름(UV)은 그림 전체가 한 방향으로 미끄러지는 것뿐이라
        구름·터널 조명에는 맞지만 지나가는 차·파도·사람에는 모자랍니다. 그 면에 진짜 영상을 걸면
        레퍼런스 영상에 그 움직임이 그대로 찍히고, 영상 모델이 「이 구역은 이렇게 움직인다」 를 읽습니다.

        둘을 **함께** 켤 수 있습니다(흐르는 영상). 서로를 끄지 않습니다 — 한쪽을 켤 때 다른 쪽을
        꺼 버리면 「왜 갑자기 흐름이 풀렸지」 가 되고, 실제로 창밖 풍경은 «흐르면서 움직이는» 것입니다.

        **기본은 꺼짐**이고, 호리존은 색 하나라 걸 자리가 없습니다(흐름과 같은 사정).
      */}
      {!horizon && roomVideo && (
        <div data-tour="env-room-video" className="space-y-1.5">
          <label
            className="flex cursor-pointer items-center gap-2 text-[9px] font-semibold"
            style={{ color: "oklch(0.52 0.01 265)" }}
            title="면·돔에 영상을 걸어 배경이 실제로 움직이게 합니다 — 레퍼런스 영상에도 그대로 찍힙니다"
          >
            <input
              type="checkbox"
              checked={!!room.video}
              onChange={(event) =>
                setState((current) =>
                  patchRoomIn(current, room.id, (item) => ({
                    ...item,
                    // 켤 때 면은 지금 방 모양에 맞춰 정합니다 — 돔이면 돔 전체, 상자면 정면(카메라가 보는 벽).
                    video: event.target.checked
                      ? { face: roomVideoFaceOf(item), source: item.video?.source ?? "" }
                      : undefined,
                  })),
                )
              }
            />
            배경 영상 — 면에 영상을 걸어 실제로 움직입니다
          </label>
          {room.video && (
            <>
              {/*
                어느 면에 걸까. 돔은 고를 것이 없습니다 — 파노라마 한 장이 곧 둘레 전부입니다.
                면 이름은 `CUBE_FACE_LABELS` 한 벌에서 옵니다(여기서 따로 적으면 배경 표시 도구와 말이 달라집니다).
              */}
              {domeLike ? (
                <p className="text-[9px]" style={{ color: "oklch(0.52 0.01 265)" }}>
                  돔 <b>전체</b>에 겁니다 — 등장방형 영상 한 편이 둘레를 두릅니다.
                </p>
              ) : (
                <label className="flex items-center gap-1.5 text-[9px]" style={{ color: "oklch(0.52 0.01 265)" }}>
                  <span className="shrink-0">어느 면</span>
                  <select
                    value={videoFace}
                    onChange={(event) =>
                      setState((current) =>
                        patchRoomIn(current, room.id, (item) => ({
                          ...item,
                          video: {
                            face: event.target.value as RoomVideoFace,
                            source: item.video?.source ?? "",
                          },
                        })),
                      )
                    }
                    className="min-w-0 flex-1 rounded px-1 py-0.5 text-[9px] outline-none"
                    style={{
                      background: "oklch(0.18 0.01 265)",
                      border: "1px solid oklch(1 0 0 / 8%)",
                      color: "oklch(0.82 0.01 265)",
                    }}
                  >
                    {COMPOSITION_CUBE_FACES.map((face) => (
                      <option key={face} value={face}>
                        {CUBE_FACE_LABELS[face]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <select
                value={room.video.source}
                onChange={(event) =>
                  setState((current) =>
                    patchRoomIn(current, room.id, (item) => ({
                      ...item,
                      video: { face: roomVideoFaceOf(item), source: event.target.value },
                    })),
                  )
                }
                title="장소 폴더에 있는 영상들입니다"
                className="w-full rounded-md px-2 py-1.5 text-[10px] outline-none"
                style={{
                  background: "oklch(0.11 0.008 265)",
                  border: "1px solid oklch(1 0 0 / 10%)",
                  color: "oklch(0.86 0.01 265)",
                }}
              >
                <option value="">
                  {roomVideo.videos.length
                    ? `걸 영상 고르기 — ${roomVideo.videos.length}편`
                    : "걸 영상이 없습니다 — 아래에서 만드세요"}
                </option>
                {roomVideo.videos.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {/*
                **만드는 길은 이미 있는 것을 씁니다**(공통 규칙 1) — 컷·카드가 쓰는 그 단추입니다.
                그 면에 걸린 그림을 첫 프레임으로 준 i2v 라, 배경이 지금 보이는 그림 그대로 움직입니다.
                면 그림이 없으면 단추를 안 냅니다 — 글만으로 뽑으면 배경이 딴 곳이 됩니다.
              */}
              {roomVideo.ownerName && faceImage && (
                <LocalGenerateButton
                  kind="video"
                  label="이 면 그림으로 영상 만들기"
                  seconds={ROOM_VIDEO_SECONDS}
                  firstFrame={faceImage}
                  prompt={backgroundLoopPrompt(roomVideo.prompt, room.name, videoFace)}
                  projectName={roomVideo.projectName}
                  assetType="background-generated"
                  ownerName={roomVideo.ownerName}
                  // 장소 폴더 안에서 «장소_배경영상_번호» 로 쌓입니다(규칙 5 — 번호는 저장 쪽이 붙입니다).
                  stem={safeFileName(`${roomVideo.ownerName}_배경영상`)}
                  onDone={(filePath, name) => {
                    roomVideo.remember(filePath, name);
                    setState((current) =>
                      patchRoomIn(current, room.id, (item) => ({
                        ...item,
                        // 만들자마자 이 면의 «배경 영상» 이 됩니다 — 만들고 또 고르게 하지 않습니다.
                        video: { face: roomVideoFaceOf(item), source: filePath },
                      })),
                    );
                  }}
                />
              )}
              <p className="text-[9px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
                재생하면 같이 돌고, 멈추면 멈추고, 눈금을 옮기면 그 시각의 프레임이 뜹니다 — <b>레퍼런스 영상</b>에도
                그대로 찍힙니다. 2~4초 루프면 이음매가 눈에 안 띕니다.
                {!faceImage && " 이 면에 그림이 없어 «만들기» 가 안 보입니다 — 먼저 전개도나 파노라마를 거세요."}
                {!roomVideo.ownerName && " 이 방에 이어 둔 장소가 없어 «만들기» 가 안 보입니다 — 아래에서 장소를 고르거나 만드세요."}
              </p>
            </>
          )}
        </div>
      )}

      {/*
        ── 호리존: 색 ─────────────────────────────────────────────────
        

        색 고르기 창(`<input type="color">`)은 **끄는 동안 한 눈금마다** change 가 옵니다 — 슬라이더와 같습니다.
        그대로 되돌리기에 쌓으면 한 번의 색 고르기가 앞의 기록을 통째로 밀어냅니다(`PlannerRange` 머리말).
        그래서 창을 여는 순간(pointerdown·키 누름)에 한 번만 `mark` 하고, 도중은 `setStateRaw` 로 갑니다.
        프리셋 단추는 한 번에 한 색이라 보통 `setState` 로 — 누름 하나가 되돌리기 한 칸입니다.

        `mark` 는 **<label> 에** 겁니다, <input> 이 아니라. 색 글자(#f2f2f2)도 label 안이라 그걸 눌러도 창이 열리는데,
        label 활성화는 input 에 **합성 click 만** 보냅니다 — input 의 pointerdown 은 영영 안 옵니다. 거기 걸어 두면
        글자를 눌러 고른 색은 되돌리기 판이 없이 `setStateRaw` 로만 가서 Ctrl+Z 가 못 되돌립니다(규칙 4).
        label 에 걸면 색칸을 누르든 글자를 누르든 pointerdown 이 label 을 한 번 지나가고, 두 벌로 안 찍힙니다.
      */}
      {horizon && room.horizon && (
        <div data-tour="env-horizon-color" className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
              호리존 색
            </span>
            <label
              className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-[9px] tabular-nums"
              style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.80 0.01 265)" }}
              title="색을 직접 고릅니다 — 여섯 면 전부가 이 색이 됩니다"
              onPointerDown={mark}
              onKeyDown={mark}
            >
              <input
                type="color"
                value={room.horizon.color}
                onChange={(event) => {
                  const next = event.target.value;
                  setStateRaw((current) => setRoomHorizonColorIn(current, room.id, next));
                }}
                className="h-4 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              {room.horizon.color}
            </label>
          </div>
          <div className="grid grid-cols-6 gap-1">
            {HORIZON_COLOR_PRESETS.map((preset) => {
              const on = preset.color === room.horizon?.color;
              return (
                <button
                  key={preset.color}
                  type="button"
                  onClick={() => setState((current) => setRoomHorizonColorIn(current, room.id, preset.color))}
                  title={`${preset.label} ${preset.color}`}
                  aria-label={preset.label}
                  className="h-6 rounded"
                  style={{
                    background: preset.color,
                    border: `2px solid ${on ? "oklch(0.80 0.15 200)" : "oklch(1 0 0 / 18%)"}`,
                    boxShadow: on ? "0 0 0 1px oklch(0.80 0.15 200 / 50%)" : "none",
                  }}
                />
              );
            })}
          </div>
          <p className="text-[9px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
            호리존은 그림을 안 붙입니다 — 전개도·파노라마·6면 세트·가릴 면 대신 <b>여섯 면이 한 가지 색</b>으로 이어집니다.
            컷 프롬프트에는 «이음매 없는 단색 배경(색 {room.horizon.color})» 으로 실립니다. 제품은 아래 «이 방의 소품» 으로 세우세요.
          </p>
        </div>
      )}

      {/*
        ── 뒤를 가릴 면 — **실내만** ───────────────────────────────────
        
        실외는 돔이라 가릴 벽이 없습니다.
      */}
      {/*
        ── 실외를 무엇으로 두를까 ────────────────────────────────────────
        

        **돔**은 각도만 맞습니다 — 제자리에서 도는 컷이면 이음매 없이 깔끔하고 그림 한 장이면 됩니다.
        **상자**는 여섯 면이 실제 기하라 카메라가 옮겨 다녀도 앞뒤·가림이 맞습니다(대신 모서리와 여섯 장의 색을 맞춰야 합니다).
      */}
      {outdoor && (
        <div data-tour="env-outdoor-shape" className="space-y-1">
          <span className="text-[9px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
            무엇으로 두를까
          </span>
          <div className="grid grid-cols-2 gap-1">
            {([
              ["dome", "돔 (파노라마 한 장)", "카메라가 제자리에서 돌 때 — 이음매 없음, 시차 없음"],
              ["box", "방형 (6면 세트)", "카메라가 옮겨 다닐 때 — 앞뒤·가림이 맞음, 모서리 이음매"],
            ] as const).map(([value, label, hint]) => {
              const on = value === (room.outdoorShape === "box" ? "box" : "dome");
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setState((current) => setOutdoorShapeIn(current, room.id, value))
                  }
                  title={hint}
                  className="rounded px-2 py-1.5 text-[9px] font-semibold"
                  style={{
                    background: on ? "oklch(0.72 0.16 60 / 22%)" : "oklch(1 0 0 / 5%)",
                    border: `1px solid ${on ? "oklch(0.72 0.16 60 / 45%)" : "transparent"}`,
                    color: on ? "oklch(0.86 0.14 60)" : "oklch(0.60 0.01 265)",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {boxLike && (
        <div data-tour="env-occlude-faces">
          <p className="text-[9px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
            뒤를 가릴 면 — 누른 면만 벽이 됩니다
          </p>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {COMPOSITION_CUBE_FACES.map((face) => {
              const on = room.occludeFaces?.[face] === true;
              return (
                <button
                  key={face}
                  type="button"
                  onClick={() =>
                    setState((current) => setFaceOccludesIn(current, face, !on, room.id))
                  }
                  title={`${CUBE_FACE_LABELS[face]} 뒤에 있는 것을 ${on ? "보이게" : "가리게"} 합니다`}
                  className="rounded px-1 py-1 text-[9px] font-semibold"
                  style={{
                    background: on ? "oklch(0.55 0.15 200 / 30%)" : "oklch(1 0 0 / 6%)",
                    color: on ? "oklch(0.84 0.13 200)" : "oklch(0.60 0.01 265)",
                  }}
                >
                  {CUBE_FACE_LABELS[face]}
                </button>
              );
            })}
          </div>
          <label
            className="mt-1.5 flex cursor-pointer items-start gap-2 rounded-md p-2 text-[9px] leading-relaxed"
            style={{ background: "oklch(1 0 0 / 4%)", color: "oklch(0.58 0.01 265)" }}
          >
            <input
              type="checkbox"
              checked={state.outerCutaway !== false}
              onChange={(event) => {
                const on = event.target.checked;
                setState((current) => ({ ...current, outerCutaway: on }));
              }}
              className="mt-0.5"
            />
            <span>
              <b style={{ color: "oklch(0.80 0.01 265)" }}>방 밖에서 외벽 투시</b>
              <br />
              외벽 그림을 붙인 방을 <b>밖</b>에서 볼 때, 안에 선 인물을 가리는 외벽만 반투명하게 걷습니다(<b>기본</b>).
            </span>
          </label>
        </div>
      )}

      {/*
        ── 이 방의 장소 ────────────────────────────────────────────────
        

        그래서 **고르기는 고르기만** 합니다(창이 안 뜹니다). 창은 «열기» 나 «만들기» 를 눌렀을 때만 뜹니다.
        호리존에는 이 칸이 없습니다 — 장소 카드가 없는 방이라, 두면 «전개도 만들기» 가 단색 벽에 그림을 뽑으려 듭니다.
      */}
      {onCreatePlace && !horizon && (
        <div className="space-y-1.5">
          {/*
            ── 이 공간의 장소 ────────────────────────────────────────
            

            그래서 이어 둔 장소가 있으면 «열기 + ×», 없으면 «만들기» 하나입니다. 실외 목록에는 파노라마 카드만 뜹니다.
            실내는 6면 세트를 고르는 것이 곧 장소를 고르는 것이라(아래) 드롭다운을 따로 두지 않습니다.
          */}
          {outdoor && (places?.length ?? 0) > 0 && onPickPlace && !placeName && (
            <select
              value=""
              onChange={(event) => onPickPlace(event.target.value)}
              className="w-full rounded-md px-2 py-1.5 text-[10px] outline-none"
              style={{
                background: "oklch(0.11 0.008 265)",
                border: "1px solid oklch(1 0 0 / 10%)",
                color: "oklch(0.86 0.01 265)",
              }}
            >
              <option value="">만들어 둔 파노라마 장소에서 고르기 — {places?.length}곳</option>
              {(places ?? []).map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name || "이름 없는 장소"}
                </option>
              ))}
            </select>
          )}
          <div className="flex gap-1">
            {placeName && onOpenPlace ? (
              <>
                <button
                  type="button"
                  data-tour="env-room-make-image"
                  onClick={onOpenPlace}
                  className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-[10px] font-semibold"
                  style={{
                    background: "oklch(0.55 0.15 200 / 18%)",
                    border: "1px solid oklch(0.55 0.15 200 / 45%)",
                    color: "oklch(0.82 0.14 200)",
                  }}
                >
                  «{placeName}» 열기 — 프롬프트·그림
                </button>
                {onPickPlace && (
                  <button
                    type="button"
                    onClick={() => onPickPlace("")}
                    title="이 공간에서 장소를 뺍니다 — 카드와 그림은 그대로 남습니다"
                    aria-label="장소 빼기"
                    className="shrink-0 rounded-md px-2 py-1.5"
                    style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.62 0.16 25)" }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                data-tour="env-room-make-image"
                onClick={() =>
                  onCreatePlace({
                    kind: domeLike ? "dome" : outdoor ? "outdoor" : "roomInner",
                    name: room.name,
                    width: room.width,
                    depth: room.depth,
                    height: room.height,
                  })
                }
                className="w-full rounded-md px-2 py-1.5 text-[10px] font-semibold"
                style={{
                  background: "oklch(0.55 0.15 200 / 18%)",
                  border: "1px solid oklch(0.55 0.15 200 / 45%)",
                  color: "oklch(0.82 0.14 200)",
                }}
              >
                {domeLike ? "파노라마 만들기" : "전개도 만들기"}
              </button>
            )}
          </div>
          <p className="text-[9px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
            지금 치수 {room.width.toFixed(1)} × {room.depth.toFixed(1)} × {room.height.toFixed(1)} m 가 프롬프트에 그대로
            박힙니다. 카드에서 그림을 등록하면{" "}
            {domeLike ? "파노라마 한 장이 이 실외의 돔으로" : "여섯 면이 잘려 이 방에"} 걸립니다.
          </p>
        </div>
      )}

      {/*
        ── 실외: 파노라마 그림 ─────────────────────────────────────────
        
      */}
      {domeLike && (
        <div
          {...dropHandlers}
          data-tour="env-panoramas"
          className="space-y-1.5 rounded-md"
          style={{
            outline: dropping ? "1px dashed oklch(0.70 0.15 200)" : "none",
            outlineOffset: 4,
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
              파노라마 그림 {panoramas.length > 0 && `(${panoramas.length})`}
            </span>
            <div className="flex items-center gap-1">
              {/*
                **바깥에서 바로 들여오기.**
                여태는 앱에서 뽑은 것만 목록에 올라, 밖에서 만든 360°(스카이박스 생성기·실촬)를 쓸 길이 없었습니다.
              */}
              {onImportPanorama && (
                <label
                  className="cursor-pointer rounded px-1.5 py-0.5 text-[9px]"
                  style={{ background: "oklch(0.55 0.15 200 / 20%)", color: "oklch(0.80 0.14 200)" }}
                  title="360° 그림 파일을 골라 목록에 넣습니다"
                >
                  불러오기
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      // 같은 파일을 다시 고를 수 있게 칸을 비웁니다 — 안 비우면 change 가 안 옵니다.
                      event.target.value = "";
                      if (file) void onImportPanorama(file);
                    }}
                  />
                </label>
              )}
              {room.panorama && (
                <button
                  type="button"
                  onClick={() => setState((current) => setRoomPanoramaIn(current, "", null, room.id))}
                  className="rounded px-1.5 py-0.5 text-[9px]"
                  style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.66 0.01 265)" }}
                >
                  돔 풀기
                </button>
              )}
            </div>
          </div>
          {panoramas.length === 0 ? (
            <div
              className="rounded-md px-2 py-3 text-center text-[9px] leading-relaxed"
              style={{
                border: `1px dashed ${dropping ? "oklch(0.70 0.15 200)" : "oklch(1 0 0 / 12%)"}`,
                background: dropping ? "oklch(0.55 0.15 200 / 12%)" : "transparent",
                color: "oklch(0.50 0.01 265)",
              }}
            >
              아직 없습니다 — 위 «파노라마 만들기» 로 뽑거나, <b>360° 그림을 여기로 끌어다 놓으세요.</b>
              <br />
              2:1 등장방형이 가장 잘 맞습니다. 앱에서 뽑은 것은 16:9(1.79:1)이라 위아래가 조금 눌립니다 —
              정확한 돔이 필요하면 2:1 로 뽑아 주는 곳(스카이박스 생성기·실촬 360)에서 받아 여기로 끌어다 놓으세요.
            </div>
          ) : (
            <div className="composition-scroll grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
              {panoramas.map((item) => {
                const on = item.id === room.panorama;
                return (
                  <div key={item.id} className="relative">
                    <button
                      type="button"
                      onClick={() => assignPanorama(item)}
                      title={`${item.name} — 누르면 이 실외의 돔이 됩니다`}
                      className="relative block h-12 w-full overflow-hidden rounded-md text-left"
                      style={{
                        border: `1px solid ${on ? "oklch(0.55 0.15 200)" : "oklch(1 0 0 / 8%)"}`,
                      }}
                    >
                      {item.thumb && (
                        <img src={item.thumb} alt={item.name} className="h-full w-full object-cover" />
                      )}
                      <span
                        className="absolute inset-x-0 bottom-0 truncate px-1 py-0.5 text-[9px]"
                        style={{
                          background: "oklch(0 0 0 / 70%)",
                          color: on ? "oklch(0.80 0.15 200)" : "white",
                        }}
                      >
                        {on ? "● " : ""}
                        {item.name}
                      </span>
                    </button>
                    {/* 지우기는 카드 위에 겹쳐 둡니다 — 줄을 하나 더 쓰면 카드가 반으로 작아집니다. */}
                    {onDeletePanorama && (
                      <button
                        type="button"
                        onClick={() => void onDeletePanorama(item)}
                        title="이 파노라마를 지웁니다 — 폴더의 원본도 함께"
                        className="absolute right-0.5 top-0.5 rounded p-0.5"
                        style={{ background: "oklch(0 0 0 / 65%)", color: "oklch(0.72 0.16 25)" }}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {panorama && (
            <p className="text-[9px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
              지금 «{panorama.name}» 이 걸려 있습니다. 카메라가 제자리인 컷용입니다 — 한가운데 눈높이 1.6 m 에서 가장
              정확하고, 멀어지면 바닥이 번집니다(무빙 컷은 6면 전개도).
            </p>
          )}
        </div>
      )}

      {/*
        ── 실내: 6면 세트 ──────────────────────────────────────────────
         면 하나하나 고르는 칸은 걷었습니다 —
        세트를 누르면 여섯 면이 한 번에 걸리고, 이름이 «…외벽» 인 세트는 바깥 껍질로 갑니다.
      */}
      {boxLike && (
        <div data-tour="env-face-sets" className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
              6면 세트 {faceSets.length > 0 && `(${faceSets.length})`}
            </span>
            <button
              type="button"
              onClick={onOpenGallery}
              title="그림을 큰 화면으로 훑어보고 면에 직접 붙입니다"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold"
              style={{ background: "oklch(0.55 0.15 200 / 14%)", color: "oklch(0.72 0.15 200)" }}
            >
              <Grid3X3 className="h-2.5 w-2.5" /> 그림 전체보기
            </button>
          </div>
          {faceSets.length === 0 ? (
            <p className="text-[9px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
              아직 없습니다 — 위 «전개도 만들기» 로 뽑은 그림이 잘리면 여기 뜹니다.
            </p>
          ) : (
            <div className="composition-scroll grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
              {faceSets.map((set) => (
                <FaceSetCard
                  key={set.id}
                  set={set}
                  cellHeight={22}
                  selected={isFaceSetAssigned(set)}
                  title={`${set.label} — 누르면 여섯 면에 한 번에 걸립니다${set.complete ? "" : ` (${set.missing.length}면 없음 → 비워 둠)`}`}
                  onClick={() => assignFaceSet(set)}
                  caption={
                    <span
                      style={{
                        color: isFaceSetAssigned(set)
                          ? "oklch(0.80 0.15 200)"
                          : "oklch(0.62 0.01 265)",
                      }}
                    >
                      {set.label}
                      {isFaceSetAssigned(set) && " · 걸림"}
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/*
        ── 이 방의 소품 ───────────────────────────────
        ,
        「그래야 소품 에셋이랑 배치한 소품도 매칭시킬 수 있고… 프롬프트 작성할 때 @로 링크 걸어 주기도 편할 거고」,
        「소품들 그룹화 시킬 수 있는 거… 방 벽에 붙일 수 있는 기능… 다 있어야 해」.

        소품은 «세우기 · 붙이기 · 묶기 · 에셋 잉기» 네 가지가 한자리에 있어야 합니다 — 세운 뒤 다른 탭으로 건너가면
        무엇을 세웠는지 잊습니다.
      */}
      <RoomProps
        state={state}
        setState={setState}
        room={room}
        assets={assets}
        onCreateAsset={onCreateAsset}
        onCreateGroupAsset={onCreateGroupAsset}
        selected={selected}
        setSelected={setSelected}
      />
    </div>
  );
}

/** 방 하나에 딸린 소품들 — 세우고, 면에 붙이고, 묶고, 에셋과 잉습니다. */
function RoomProps({
  state,
  setState,
  room,
  assets,
  onCreateAsset,
  onCreateGroupAsset,
  selected,
  setSelected,
}: {
  state: CompositionState;
  setState: UpdateComposition;
  room: CompositionRoom;
  assets: NonNullable<EnvironmentPanelProps["assetOptions"]>;
  onCreateAsset?: (objectId: string, label: string) => void;
  onCreateGroupAsset?: (groupId: string, label: string) => void;
  selected?: string;
  setSelected?: (value: string) => void;
}) {
  const props = objectsInRoom(state, room.id);
  const pickedId = selected?.startsWith("object:") ? selected.slice(7) : null;
  const picked = props.find((item) => item.id === pickedId) ?? null;
  /** 고른 것이 **덩어리**인가 — 그러면 덩어리 카드만 냅니다(낱개 칸은 뜻이 없습니다). */
  const pickedGroup = objectGroupOf(state, picked?.groupId);
  /** 이어 둔 에셋이 아직 있는가 — 지운 에셋을 가리키면 «없는 것» 으로 봅니다. */
  const linkedAsset =
    picked?.swapRef &&
    assets.find(
      (item) => item.kind === picked.swapRef!.kind && item.id === picked.swapRef!.id,
    );

  return (
    <div data-tour="env-room-props" className="space-y-1.5">
      <span className="text-[9px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
        이 방의 소품 {props.length > 0 && `(${props.length})`}
      </span>

      <div className="grid grid-cols-3 gap-1">
        {OBJECT_KINDS.map((kind) => (
          <button
            key={kind.label}
            type="button"
            onClick={() =>
              setState((current) => {
                const seated = addObjectInRoom(current, kind, room.id);
                setSelected?.(`object:${seated.id}`);
                return seated.state;
              })
            }
            title={`«${room.name}» 안에 ${kind.label} 을(를) 세웁니다`}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[9px]"
            style={{ background: "oklch(1 0 0 / 5%)", color: "oklch(0.64 0.01 265)" }}
          >
            <kind.icon className="h-3 w-3 shrink-0" style={{ opacity: 0.7 }} />
            {kind.label}
          </button>
        ))}
      </div>

      {/* 목록·묶기·이름 고치기는 배치 탭과 **같은 부품**입니다(CLAUDE.md 규칙 1). */}
      <ObjectList
        state={state}
        setState={setState}
        objects={props}
        selected={selected ?? "none"}
        setSelected={(value) => setSelected?.(value)}
        emptyNote="아직 없습니다 — 위에서 골라 세우면 방 한가운데에 서고, «붙일 면» 을 고르면 그 면에 닿습니다."
      />

      {/* ── 고른 덩어리 ─────────────────────────────────────────────── */}
      {pickedGroup && (
        <GroupCards
          state={state}
          setState={setState}
          groupIds={[pickedGroup.id]}
          assets={assets}
          onCreateAsset={onCreateGroupAsset}
        />
      )}

      {/* ── 고른 소품 ───────────────────────────────────────────────── */}
      {picked && !pickedGroup && (
        <div
          className="space-y-1 rounded p-1.5"
          style={{ background: "oklch(0.55 0.15 200 / 10%)", border: "1px solid oklch(0.62 0.15 200 / 35%)" }}
        >
          <div className="flex items-center justify-between">
            <span className="min-w-0 truncate text-[10px] font-semibold" style={{ color: "oklch(0.86 0.13 200)" }}>
              {picked.label}
            </span>
            {/*
              투시 —  시간대별로 바꾸려면 타임라인의 그 소품 줄에 키를 찍습니다.
            */}
            <button
              type="button"
              onClick={() =>
                setState((current) =>
                  updateObjectIn(current, picked.id, { seeThrough: !picked.seeThrough }),
                )
              }
              title={
                picked.seeThrough
                  ? "투시 끄기 — 뒤를 다시 가립니다"
                  : "투시 — 뒤가 비치고 카메라를 막지 않습니다"
              }
              className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold"
              style={{
                background: picked.seeThrough ? "oklch(0.72 0.16 60 / 26%)" : "oklch(1 0 0 / 5%)",
                color: picked.seeThrough ? "oklch(0.86 0.14 60)" : "oklch(0.52 0.01 265)",
              }}
            >
              투시
            </button>
          </div>

          {/*
            붙일 면. 
            붙이면 닿는 축만 방이 잡고 나머지는 끄는 대로 미끄러집니다 — 방을 넓혀도 따라붙습니다.
          */}
          <label className="flex items-center gap-1 text-[9px]" style={{ color: "oklch(0.52 0.01 265)" }}>
            붙일 면
            <select
              value={picked.mount?.roomId === room.id ? picked.mount.face : ""}
              onChange={(event) =>
                setState((current) =>
                  mountObjectToFaceIn(
                    current,
                    picked.id,
                    room.id,
                    (event.target.value || null) as CompositionCubeFace | null,
                  ),
                )
              }
              className="min-w-0 flex-1 rounded px-1 py-0.5 text-[9px] outline-none"
              style={{
                background: "oklch(0.18 0.01 265)",
                border: "1px solid oklch(1 0 0 / 10%)",
                color: "oklch(0.86 0.01 265)",
              }}
            >
              <option value="">안 붙임 — 공중에 둡니다</option>
              {COMPOSITION_CUBE_FACES.map((face) => (
                <option key={face} value={face}>
                  {CUBE_FACE_LABELS[face]}
                </option>
              ))}
            </select>
          </label>

          {/*
            **벽과 조명에는 에셋이 없습니다.**
          */}
          {SWAPPABLE_KINDS.includes(picked.kind) && (
            <>
              <select
                value={linkedAsset ? `${linkedAsset.kind}:${linkedAsset.id}` : ""}
                onChange={(event) => {
                  const found = assets.find(
                    (item) => `${item.kind}:${item.id}` === event.target.value,
                  );
                  setState((current) => setObjectSwapIn(current, picked.id, found ?? null));
                }}
                className="w-full rounded px-1 py-0.5 text-[9px] outline-none"
                style={{
                  background: "oklch(0.18 0.01 265)",
                  border: "1px solid oklch(1 0 0 / 10%)",
                  color: "oklch(0.86 0.01 265)",
                }}
              >
                <option value="">
                  {assets.some((item) => item.kind === "asset")
                    ? "에셋 안 고름 — 이름만 프롬프트에"
                    : "만들어 둔 에셋이 없습니다"}
                </option>
                {assets
                  .filter((item) => item.kind === "asset")
                  .map((item) => (
                    <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>
                      {item.group} · {item.name}
                    </option>
                  ))}
              </select>

              {onCreateAsset && (
                <button
                  type="button"
                  onClick={() => onCreateAsset(picked.id, picked.label)}
                  className="w-full rounded px-2 py-1 text-[9px] font-semibold"
                  style={{
                    background: "oklch(0.70 0.15 160 / 16%)",
                    border: "1px solid oklch(0.70 0.15 160 / 40%)",
                    color: "oklch(0.82 0.14 160)",
                  }}
                >
                  {linkedAsset
                    ? `«${linkedAsset.name}» 열기 — 시트 뽑기`
                    : "이 소품의 에셋 만들기 — 시트를 뽑아 바로 잇습니다"}
                </button>
              )}
            </>
          )}

          <ObjectFields
            object={picked}
            onChange={(patch) => setState((current) => updateObjectIn(current, picked.id, patch))}
          />
        </div>
      )}
    </div>
  );
}

export default EnvironmentPanel;
