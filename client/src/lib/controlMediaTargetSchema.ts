import { z } from "zod";

/** 앱 조종기의 이미지·영상 저장 대상. 생성과 외부 결과 가져오기가 함께 씁니다. */
export const mediaTargetSchema = z.object({
  kind: z.enum(["character", "background", "cut"]),
  id: z.string().min(1).max(200),
}).strict();
