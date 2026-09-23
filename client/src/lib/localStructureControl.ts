import { z } from "zod";

/** 영상의 원래 시각을 유지합니다. 다른 길이로 늘이거나 마지막 장을 채우지 않습니다. */
export const structureControlSettingsSchema = z.object({
  kind: z.literal("canny"),
  sourceStartSeconds: z.number().finite().min(0).max(86400).default(0),
  durationSeconds: z.number().finite().min(1).max(60),
  weight: z.number().finite().min(0).max(1).default(1),
  thresholds: z.object({
    low: z.number().int().min(0).max(255).default(92),
    high: z.number().int().min(0).max(255).default(200),
  }).strict().refine(value => value.low < value.high).optional(),
}).strict();

export const structureSourceSchema = structureControlSettingsSchema.extend({
  assetId: z.string().min(1).max(200),
}).strict();

export const structureControlSchema = structureControlSettingsSchema.extend({
  path: z.string().trim().min(1).max(32768),
}).strict();

export type LocalStructureControl = z.infer<typeof structureControlSchema>;
