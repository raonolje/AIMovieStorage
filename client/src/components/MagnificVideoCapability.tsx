import { useT } from "@/lib/i18n";
import { useMagnificStatus } from "@/lib/magnificMcp";
import { useMagnificModels } from "@/lib/magnificModels";
import { MAGNIFIC_VIDEO_MODEL } from "@/lib/magnificCompose";
import { findMagnificVideoModel, supportsVideoReference, videoCapabilityLabel, videoInputKind } from "@/lib/magnificVideoInputs";

/** 목록에 없는 모델을 이름만 보고 지원한다고 약속하지 않습니다. */
export default function MagnificVideoCapability({ modelId, hasRefVideo }: { modelId?: string; hasRefVideo: boolean }) {
  const t = useT();
  const status = useMagnificStatus();
  const catalog = useMagnificModels("video", status.connected);
  const selected = findMagnificVideoModel(catalog.models, modelId || MAGNIFIC_VIDEO_MODEL);
  return (
    <div className="space-y-1 rounded border border-white/10 p-2 text-[10px] text-white/60">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{t("Magnific 입력 지원")}{selected ? ` · ${selected.name}` : ""}</span>
        <button type="button" disabled={!status.connected || catalog.loading} onClick={() => void catalog.reload()}
          className="rounded bg-white/5 px-2 py-1 disabled:opacity-40">{t("목록 새로고침")}</button>
      </div>
      <p>{videoCapabilityLabel(selected)}</p>
      {hasRefVideo && supportsVideoReference(selected) !== true && (
        <p className="text-amber-300">{t("영상 입력을 확인할 수 없으면 전송을 멈춥니다. 첫 프레임으로 자동 대체하지 않습니다.")}</p>
      )}
      {videoInputKind(selected) === "motion" && (
        <p className="text-amber-300">{t("동작 전용 모델은 시작 인물 입력을 따로 확인해야 합니다. 구도 영상만으로 카메라와 공간이 유지된다고 가정하지 마세요.")}</p>
      )}
      {hasRefVideo && <p>{t("그림만 쓰려면 위의 ‘레퍼런스 영상 쓰기’를 직접 끄세요. 카메라 움직임은 영상으로 전달되지 않습니다.")}</p>}
      <p>{t("MCP 목록의 입력 지원과 데스크톱 캔버스 연결은 별개입니다. ‘영상으로’ 구성 후 영상 노드 연결과 모델을 확인하세요.")}</p>
      {catalog.failed && <p className="text-amber-300">{catalog.failed}</p>}
    </div>
  );
}
