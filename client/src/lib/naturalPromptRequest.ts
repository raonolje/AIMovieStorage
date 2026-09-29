import type { ProjectContextSummary } from "@/lib/projectContext";

export function naturalPromptRequestData(input: {
  text: string; kind: "acting" | "vfx" | "background" | "scene";
  isVideo?: boolean; seconds?: number; shot?: string; people?: string[];
  context?: ProjectContextSummary | null;
}) {
  return {
    text: input.text.trim(), kind: input.kind, isVideo: Boolean(input.isVideo),
    seconds: input.seconds ?? null, shot: input.shot ?? null,
    people: input.people ?? [], project: input.context?.facts ?? null,
  };
}
