import { runLocalToProject } from "./localOutput";
import type { CharacterVoiceReference } from "./projectTypes";

export const VOICE_MODELS = ["design", "custom-1.7b", "custom-0.6b"] as const;
export type VoiceModel = typeof VOICE_MODELS[number];
export const VOICE_CATEGORIES = ["actor", "singer", "idol", "announcer", "weather", "radio", "ordinary"] as const;
export type VoiceCategory = typeof VOICE_CATEGORIES[number];
export const VOICE_GENDERS = ["unspecified", "female", "male", "androgynous"] as const;
export type VoiceGender = typeof VOICE_GENDERS[number];
export const VOICE_AGE_RANGES = ["unspecified", "teens", "twenties", "thirties", "forties", "fifties", "sixties_plus"] as const;
export type VoiceAgeRange = typeof VOICE_AGE_RANGES[number];
export const VOICE_SPEAKERS = ["Sohee", "Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden", "Ono_Anna"] as const;
export const VOICE_LANGUAGES = ["Korean", "English", "Japanese", "Chinese", "German", "French", "Russian", "Portuguese", "Spanish", "Italian", "Auto"] as const;
export type VoiceLanguage = typeof VOICE_LANGUAGES[number];

export const VOICE_CATEGORY_LABEL: Record<VoiceCategory, string> = {
  actor: "배우", singer: "가수", idol: "아이돌", announcer: "아나운서", weather: "기상캐스터", radio: "라디오 진행자", ordinary: "일반 사람",
};
export const VOICE_GENDER_LABEL: Record<VoiceGender, string> = {
  unspecified: "지정 안 함", female: "여성", male: "남성", androgynous: "중성적인 목소리",
};
export const VOICE_AGE_LABEL: Record<VoiceAgeRange, string> = {
  unspecified: "지정 안 함", teens: "10대", twenties: "20대", thirties: "30대", forties: "40대", fifties: "50대", sixties_plus: "60대 이상",
};
const CATEGORY_INSTRUCTION: Record<VoiceCategory, string> = {
  actor: "배우처럼 대사의 감정과 상황을 살려 자연스럽게 연기하세요.",
  singer: "가수의 인터뷰나 무대 멘트처럼 호흡과 공명을 살려 자연스럽게 말하세요. 노래하지 말고 대사를 말하세요.",
  idol: "아이돌의 팬 소통이나 무대 멘트처럼 생기 있고 친근하게 말하세요. 노래하지 말고 대사를 말하세요.",
  announcer: "아나운서처럼 발음을 또렷하게 하되 과장하지 않고 신뢰감 있게 말하세요.",
  weather: "기상캐스터처럼 밝고 명료하며 전달력 있는 톤으로 말하세요.",
  radio: "라디오 진행자처럼 가까이서 대화하듯 따뜻하고 자연스럽게 말하세요.",
  ordinary: "일반 사람이 실제 대화하듯 자연스럽고 담백하게 말하세요.",
};
const CATEGORY_INSTRUCTION_EN: Record<VoiceCategory, string> = {
  actor: "Perform the line like an actor, with believable emotion and natural timing.",
  singer: "Speak like a singer in an interview or on-stage introduction, with expressive breath and resonance. Speak the line; do not sing it.",
  idol: "Speak like an idol addressing fans or introducing a performance: lively, warm and natural. Speak the line; do not sing it.",
  announcer: "Speak like a news announcer: clear diction, composed and credible.",
  weather: "Speak like a weather presenter: bright, clear and easy to follow.",
  radio: "Speak like a radio host: warm, intimate and conversational.",
  ordinary: "Speak like an everyday person in a natural conversation.",
};

export function voiceInstruction(category: VoiceCategory, traits: string, language: VoiceLanguage,
  gender: VoiceGender = "unspecified", ageRange: VoiceAgeRange = "unspecified"): string {
  const korean = language === "Korean";
  const genderText = ({
    unspecified: "",
    female: korean ? "여성 목소리" : "a feminine voice",
    male: korean ? "남성 목소리" : "a masculine voice",
    androgynous: korean ? "중성적인 목소리" : "an androgynous voice",
  } satisfies Record<VoiceGender, string>)[gender];
  const ageText = ({
    unspecified: "",
    teens: korean ? "10대" : "a teenager",
    twenties: korean ? "20대" : "an adult in their twenties",
    thirties: korean ? "30대" : "an adult in their thirties",
    forties: korean ? "40대" : "an adult in their forties",
    fifties: korean ? "50대" : "an adult in their fifties",
    sixties_plus: korean ? "60대 이상" : "an adult in their sixties or older",
  } satisfies Record<VoiceAgeRange, string>)[ageRange];
  const characteristics = [genderText, ageText, traits.trim()].filter(Boolean).join(", ");
  return korean
    ? `${CATEGORY_INSTRUCTION[category]} 목소리 특징: ${characteristics}`
    : `${CATEGORY_INSTRUCTION_EN[category]} Voice traits: ${characteristics}`;
}

export function voiceDescription(category: VoiceCategory, traits: string, gender: VoiceGender = "unspecified",
  ageRange: VoiceAgeRange = "unspecified"): string {
  return [VOICE_CATEGORY_LABEL[category], gender === "unspecified" ? "" : VOICE_GENDER_LABEL[gender],
    ageRange === "unspecified" ? "" : VOICE_AGE_LABEL[ageRange], traits.trim()].filter(Boolean).join(" · ");
}

export interface CharacterVoiceGeneration {
  projectName: string;
  characterName: string;
  dialogue: string;
  category: VoiceCategory;
  gender?: VoiceGender;
  ageRange?: VoiceAgeRange;
  traits: string;
  model: VoiceModel;
  speaker?: string;
  language: VoiceLanguage;
  operationId?: string;
  onProgress?: (message: string) => void;
}

/** 카드와 조종기가 동일한 로컬 모델·저장 폴더·연기 지시를 사용합니다. */
export async function generateCharacterVoice(input: CharacterVoiceGeneration): Promise<CharacterVoiceReference> {
  const dialogue = input.dialogue.trim();
  const traits = input.traits.trim();
  if (!dialogue || dialogue.length > 1000) throw new Error("대사는 1~1000자로 입력하세요.");
  if (!traits || traits.length > 500) throw new Error("목소리 특징은 1~500자로 입력하세요.");
  if (input.model !== "design" && !VOICE_SPEAKERS.some((speaker) => speaker === input.speaker))
    throw new Error("고정 목소리 모델의 화자를 선택하세요.");
  const made = await runLocalToProject({
    engine: "qwentts", kind: "audio", extension: "wav",
    projectName: input.projectName, assetType: "character-voice", ownerName: input.characterName,
    stem: `${input.characterName}_목소리`,
    opts: { prompt: dialogue, voice_model: input.model, voice_speaker: input.speaker,
      voice_instruct: voiceInstruction(input.category, traits, input.language, input.gender, input.ageRange), language: input.language },
    timeoutSecs: 1800,
    onProgress: input.onProgress,
  });
  return { id: crypto.randomUUID(), operationId: input.operationId, filePath: made.path,
    source: "generated", dialogue, category: input.category, gender: input.gender ?? "unspecified",
    ageRange: input.ageRange ?? "unspecified", traits, model: input.model,
    speaker: input.model === "design" ? undefined : input.speaker, language: input.language,
    isPrimary: true };
}
