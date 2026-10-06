import { useState } from "react";
import { toast } from "sonner";
import { assetSrc, deleteProjectMediaFile, fileStem } from "@/lib/mediaLibrary";
import { useT } from "@/lib/i18n";
import { extractVoiceFromPrimary, withPrimaryVoice } from "@/lib/characterVoice";
import { installLocalEngine, useLocalEngines } from "@/lib/localEngines";
import { generateCharacterVoice, voiceDescription, VOICE_AGE_LABEL, VOICE_AGE_RANGES, VOICE_CATEGORIES, VOICE_CATEGORY_LABEL, VOICE_GENDER_LABEL, VOICE_GENDERS, VOICE_LANGUAGES, VOICE_MODELS, VOICE_SPEAKERS,
  type VoiceAgeRange, type VoiceCategory, type VoiceGender, type VoiceLanguage, type VoiceModel } from "@/lib/voiceGeneration";
import type { Character, ProjectDraft } from "@/lib/projectTypes";

/** 다중 화자 영상의 화자를 자동으로 추측하지 않습니다. 사람이 대표영상·대사 구간을 고릅니다. */
export default function CharacterVoicePanel({ character, draft, projectName, onPatch, onVoicePatch }: {
  character: Character; draft: ProjectDraft;
  projectName: string;
  onPatch: (update: (current: Character) => Partial<Character>) => void;
  onVoicePatch?: (update: (current: Character) => Partial<Character>) => void;
}) {
  const t = useT();
  const options = draft.scenes.flatMap((scene) => scene.cuts
    .filter((cut) => cut.characterIds.includes(character.id))
    .flatMap((cut) => cut.videos.filter((video) => video.isPrimary && video.filePath)
      .map((video) => ({ cut, video, label: `${scene.title || "장면"} · ${cut.title || `컷 ${cut.order}`} · ${video.name}` }))));
  const [source, setSource] = useState("");
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState("5");
  const [busy, setBusy] = useState(false);
  const [dialogue, setDialogue] = useState("");
  const [traits, setTraits] = useState("");
  const primaryGenerated = character.voiceReferences?.find((item) => item.isPrimary && item.source === "generated");
  const [category, setCategory] = useState<VoiceCategory>(() => VOICE_CATEGORIES.find((value) => value === primaryGenerated?.category) ?? "actor");
  const [gender, setGender] = useState<VoiceGender>(() => VOICE_GENDERS.find((value) => value === primaryGenerated?.gender) ?? "unspecified");
  const [ageRange, setAgeRange] = useState<VoiceAgeRange>(() => VOICE_AGE_RANGES.find((value) => value === primaryGenerated?.ageRange) ?? "unspecified");
  const [model, setModel] = useState<VoiceModel>("design");
  const [speaker, setSpeaker] = useState("Sohee");
  const [language, setLanguage] = useState<VoiceLanguage>("Korean");
  const [progress, setProgress] = useState("");
  const engine = useLocalEngines().engines.find((item) => item.id === "qwentts");
  const chosen = options.find(({ video }) => video.id === source) ?? options[0];
  const extract = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    try {
      const reference = await extractVoiceFromPrimary({
        draft, projectName, characterId: character.id, sourceCutId: chosen.cut.id,
        sourceVideoId: chosen.video.id, startSeconds: Number(start), endSeconds: Number(end),
      });
      (onVoicePatch || onPatch)((current) => withPrimaryVoice(current, reference));
      toast.success(t("{name} 음성을 캐릭터 폴더에 저장했습니다.", { name: character.name }));
    } catch (error) { toast.error(String(error)); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    const reference = character.voiceReferences?.find((item) => item.id === id);
    if (!reference) return;
    const deleted = await deleteProjectMediaFile(projectName, reference.filePath);
    if (!deleted) { toast.error(t("음성 파일을 지우지 못했습니다.")); return; }
    (onVoicePatch || onPatch)((current) => ({ voiceReferences: (current.voiceReferences || []).filter((item) => item.id !== id) }));
  };
  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setProgress("");
    try {
      const reference = await generateCharacterVoice({
        projectName, characterName: character.name, dialogue, traits: traits || character.voiceDescription || "자연스럽고 개성 있는 목소리",
        category, gender, ageRange, model, speaker, language, onProgress: setProgress,
      });
      (onVoicePatch || onPatch)((current) => ({
        ...withPrimaryVoice(current, reference),
        voiceDescription: current.voiceDescription?.trim() || voiceDescription(category, traits || "자연스럽고 개성 있는 목소리", gender, ageRange),
      }));
      toast.success(t("{name} 음성을 캐릭터 폴더에 저장했습니다.", { name: character.name }));
    } catch (error) { toast.error(String(error)); }
    finally { setBusy(false); setProgress(""); }
  };
  return <section className="space-y-2 rounded-lg border border-white/10 p-3 text-xs" data-tour="character-voice">
    <h3 className="font-semibold text-white">{t("목소리 레퍼런스")}</h3>
    <p className="text-white/50">{t("대표 영상에서 이 인물만 말하는 구간을 지정하세요. 추출한 WAV는 캐릭터 폴더에 저장되고 영상 구성에 함께 올라갑니다.")}</p>
    <label className="block text-white/70">{t("첫 등장 목소리 특징 (한글)")}
      <textarea className="mt-1 w-full rounded bg-black/30 p-2 text-white" value={character.voiceDescription || ""}
        onChange={(event) => (onVoicePatch || onPatch)(() => ({ voiceDescription: event.target.value }))}
        placeholder="예: 낮고 차분한 중저음, 또렷한 발음, 짧은 호흡" />
    </label>
    <label className="block text-white/70">Voice characteristics (English)
      <textarea className="mt-1 w-full rounded bg-black/30 p-2 text-white" value={character.voiceDescriptionEn || ""}
        onChange={(event) => (onVoicePatch || onPatch)(() => ({ voiceDescriptionEn: event.target.value }))}
        placeholder="e.g. low, calm mid-range voice with crisp diction" />
    </label>
    <div className="space-y-2 rounded-lg border border-violet-400/20 bg-violet-400/5 p-3" data-tour="character-voice-generate">
      <h4 className="font-semibold text-violet-200">{t("캐릭터 목소리 생성")}</h4>
      <p className="text-white/50">{t("첫 영상 전에도 목소리를 만들 수 있습니다. 대사와 연기 톤을 적고 로컬 모델을 선택하세요.")}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label>{t("분위기")}
          <select className="mt-1 w-full rounded bg-black/30 p-2 text-white" value={category}
            onChange={(event) => setCategory(event.target.value as VoiceCategory)}>
            {Object.entries(VOICE_CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}
          </select>
        </label>
        <label>{t("목소리 성별")}
          <select className="mt-1 w-full rounded bg-black/30 p-2 text-white" value={gender}
            onChange={(event) => setGender(event.target.value as VoiceGender)}>
            {Object.entries(VOICE_GENDER_LABEL).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}
          </select>
        </label>
        <label>{t("목소리 나이대")}
          <select className="mt-1 w-full rounded bg-black/30 p-2 text-white" value={ageRange}
            onChange={(event) => setAgeRange(event.target.value as VoiceAgeRange)}>
            {Object.entries(VOICE_AGE_LABEL).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}
          </select>
        </label>
        <label>{t("로컬 목소리 모델")}
          <select className="mt-1 w-full rounded bg-black/30 p-2 text-white" value={model}
            onChange={(event) => setModel(event.target.value as VoiceModel)}>
            {VOICE_MODELS.map((value) => <option key={value} value={value}>{value === "design" ? "Qwen3 VoiceDesign 1.7B" : `Qwen3 CustomVoice ${value.slice(7)}`}</option>)}
          </select>
        </label>
        <label>{t("대사 언어")}
          <select className="mt-1 w-full rounded bg-black/30 p-2 text-white" value={language}
            onChange={(event) => setLanguage(event.target.value as VoiceLanguage)}>
            {VOICE_LANGUAGES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      {model !== "design" && <label className="block">{t("고정 화자")}
        <select className="mt-1 w-full rounded bg-black/30 p-2 text-white" value={speaker}
          onChange={(event) => setSpeaker(event.target.value)}>
          {VOICE_SPEAKERS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>}
      <p className="text-white/50">{t("가수·아이돌은 말하는 목소리 연출입니다. 노래 생성은 지원하지 않습니다. 고정 화자 모델은 성별·나이대에 맞게 음색이 바뀌지 않을 수 있습니다.")}</p>
      <label className="block">{t("대사")}
        <textarea className="mt-1 w-full rounded bg-black/30 p-2 text-white" value={dialogue} maxLength={1000}
          onChange={(event) => setDialogue(event.target.value)} placeholder={t("예: 정말 여기서 다시 만날 줄은 몰랐어요.")} />
      </label>
      <label className="block">{t("목소리 특징·연기 톤")}
        <textarea className="mt-1 w-full rounded bg-black/30 p-2 text-white" value={traits} maxLength={500}
          onChange={(event) => setTraits(event.target.value)} placeholder={character.voiceDescription || t("예: 낮은 중저음, 숨을 고른 뒤 반가움이 묻어나게")} />
      </label>
      {!engine?.installed ? <button type="button" disabled={busy || engine?.installing} onClick={() => void installLocalEngine("qwentts").catch((error) => toast.error(String(error)))}
        className="rounded bg-violet-600 px-3 py-2 font-semibold text-white disabled:opacity-50">{engine?.installing ? t("설치 중…") : t("Qwen3-TTS 설치")}</button>
        : <button type="button" disabled={busy || !dialogue.trim()} onClick={() => void generate()}
          className="rounded bg-violet-600 px-3 py-2 font-semibold text-white disabled:opacity-50">{busy ? t("목소리 생성 중…") : t("캐릭터 목소리 생성")}</button>}
      {progress && <p role="status" className="text-violet-200">{progress}</p>}
    </div>
    {options.length > 0 && <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-[220px] flex-1">{t("대표 영상")}
        <select className="mt-1 w-full rounded bg-black/30 p-2 text-white" value={chosen?.video.id || ""}
          onChange={(event) => setSource(event.target.value)}>
          {options.map(({ video, label }) => <option key={video.id} value={video.id}>{label}</option>)}
        </select>
      </label>
      <label>{t("시작(초)")}<input type="number" min="0" step="0.1" className="mt-1 block w-20 rounded bg-black/30 p-2 text-white" value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label>{t("끝(초)")}<input type="number" min="0" step="0.1" className="mt-1 block w-20 rounded bg-black/30 p-2 text-white" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      <button type="button" disabled={busy} className="rounded bg-violet-600 px-3 py-2 font-semibold text-white disabled:opacity-50" onClick={() => void extract()}>
        {busy ? t("추출 중…") : t("음성 추출")}
      </button>
    </div>}
    {options.length === 0 && <p className="text-amber-300/80">{t("이 인물이 등장하는 컷의 영상을 대표로 선택하면 추출할 수 있습니다.")}</p>}
    {(character.voiceReferences || []).map((item) => <div key={item.id} className="flex items-center gap-2 rounded bg-black/20 p-2">
      <button type="button" title={t("음성 대표 선택")} onClick={() => (onVoicePatch || onPatch)((current) => ({ voiceReferences: current.voiceReferences?.map((entry) => ({ ...entry, isPrimary: entry.id === item.id })) }))}>
        {item.isPrimary ? "★" : "☆"}
      </button>
      <span className="min-w-0 flex-1 truncate" title={item.filePath}>{fileStem(item.filePath)} · {item.source === "generated" ? `${t("생성")} · ${item.model}` : item.source === "imported" ? t("입력 음원") : `${item.startSeconds}–${item.endSeconds}s`}</span>
      <audio controls preload="none" src={assetSrc(item.filePath) || undefined} className="h-8 max-w-[180px]" />
      <button type="button" onClick={() => void remove(item.id)} className="text-red-300">{t("삭제")}</button>
    </div>)}
  </section>;
}
