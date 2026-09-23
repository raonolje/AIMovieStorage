import { z } from "zod";
import * as edit from "@/lib/compositionEdit";
import type { CompositionState, Vector3Value } from "@/lib/composition";
import { SHOT_PRESETS } from "@/lib/cameraMoves";
import { EDITABLE_BONES, fingerStateToBonePose } from "@/lib/rig";

const id = z.string().min(1).max(200);
const label = z.string().min(1).max(500);
const scalar = z.number().finite().min(-10000).max(10000);
const vector = z.object({ x: scalar, y: scalar, z: scalar }).strict();
const scale = z
  .object({
    x: z.number().min(0.001).max(1000),
    y: z.number().min(0.001).max(1000),
    z: z.number().min(0.001).max(1000),
  })
  .strict();
const seconds = z.number().min(0).max(86400);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const face = z.enum(["front", "back", "left", "right", "top", "bottom"]);
const channel = z.enum(["position", "rotation", "scale", "pose"]);
const easing = z
  .object({
    p1x: z.number().min(0).max(1),
    p1y: scalar,
    p2x: z.number().min(0).max(1),
    p2y: scalar,
  })
  .strict();
const transform = {
  positionMeters: vector.optional(),
  rotationDegrees: vector.optional(),
};
const pose = z.enum([
  "stand",
  "walk",
  "run",
  "sit",
  "sitGround",
  "kneel",
  "crouch",
  "lie",
  "armsUp",
  "point",
  "aim",
  "hold",
  "lean",
  "reach",
  "think",
  "wave",
  "fight",
  "fall",
]);
const objectKind = z.enum([
  "table",
  "crate",
  "light",
  "box",
  "sphere",
  "cylinder",
  "wall",
]);

// 외부 입력도 화면과 같은 변환 함수를 거칩니다. 저장본 전체/실행할 코드를 받으면 검증과 되돌리기를 우회하게 됩니다.
export const compositionCommandSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("camera.set"),
      positionMeters: vector.optional(),
      targetMeters: vector.optional(),
      fovDegrees: z.number().min(12).max(90).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("camera.speed"),
      multiplier: z.number().min(0.2).max(3),
    })
    .strict(),
  z
    .object({
      op: z.literal("room.add"),
      kind: z.enum(["indoor", "outdoor", "horizon"]),
      name: label.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("room.update"),
      id,
      name: label.optional(),
      widthMeters: z.number().min(0.4).max(400).optional(),
      depthMeters: z.number().min(0.4).max(400).optional(),
      heightMeters: z.number().min(0.4).max(400).optional(),
      positionMeters: vector.optional(),
      rotationDegrees: scalar.optional(),
      hidden: z.boolean().optional(),
      horizonColor: color.optional(),
      outdoorShape: z.enum(["dome", "box"]).optional(),
    })
    .strict(),
  z.object({ op: z.literal("room.select"), id }).strict(),
  z.object({ op: z.literal("room.remove"), id }).strict(),
  z
    .object({
      op: z.literal("room.face"),
      id,
      face,
      imageId: z.string().max(200),
      shell: z.enum(["inner", "outer"]).default("inner"),
    })
    .strict(),
  z
    .object({
      op: z.literal("room.panorama"),
      id,
      imageId: z.string().max(200),
    })
    .strict(),
  z
    .object({
      op: z.literal("room.occlusion"),
      id,
      face,
      occludes: z.boolean(),
    })
    .strict(),
  z
    .object({
      op: z.literal("room.face_ratio"),
      id,
      ratio: z
        .object({
          width: z.number().positive().max(1000),
          depth: z.number().positive().max(1000),
        })
        .strict()
        .nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal("room.side_crop"),
      id,
      fraction: z.number().min(0).max(0.95),
    })
    .strict(),
  z.object({ op: z.literal("character.place"), id }).strict(),
  z
    .object({
      op: z.literal("character.update"),
      id,
      ...transform,
      pose: pose.optional(),
      hidden: z.boolean().optional(),
      heightCm: z.number().min(20).max(400).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("character.color"),
      ids: z.array(id).min(1).max(200),
      color: color.nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal("mannequin.add"),
      gender: z.enum(["male", "female"]),
      name: label.optional(),
    })
    .strict(),
  z.object({ op: z.literal("mannequin.remove"), id }).strict(),
  z
    .object({
      op: z.literal("mannequin.update"),
      id,
      name: label.optional(),
      heightCm: z.number().min(20).max(400).optional(),
      build: z.enum(["slim", "average", "heavy"]).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("pose.bone"),
      id,
      bone: id,
      rotationDegrees: vector,
    })
    .strict(),
  z
    .object({
      op: z.literal("pose.finger"),
      id,
      side: z.enum(["Left", "Right"]),
      finger: z.enum(["Thumb", "Index", "Middle", "Ring", "Pinky"]),
      state: z.enum(["extend", "half", "fold"]),
    })
    .strict(),
  z.object({ op: z.literal("pose.reset"), id }).strict(),
  z
    .object({
      op: z.literal("object.add"),
      kind: objectKind,
      label,
      roomId: id.optional(),
      lightType: z.enum(["point", "area"]).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("object.update"),
      id,
      ...transform,
      scale: scale.optional(),
      label: label.optional(),
      color: color.optional(),
      visible: z.boolean().optional(),
      seeThrough: z.boolean().optional(),
      intensity: z.number().min(0).max(1000).optional(),
      describeAs: z.string().max(2000).optional(),
      wholeGroup: z.boolean().default(false),
    })
    .strict(),
  z.object({ op: z.literal("object.remove"), id }).strict(),
  z
    .object({
      op: z.literal("object.mount"),
      id,
      roomId: id,
      face: face.nullable(),
    })
    .strict(),
  z
    .object({ op: z.literal("object.attach"), id, characterId: id, bone: id })
    .strict(),
  z
    .object({
      op: z.literal("object.detach"),
      id,
      worldPositionMeters: vector,
      worldRotationDegrees: vector.optional(),
    })
    .strict(),
  z
    .object({ op: z.literal("object.pivot"), id, positionMeters: vector })
    .strict(),
  z
    .object({
      op: z.literal("group.create"),
      ids: z.array(id).min(2).max(200),
      name: label.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("group.update"),
      id,
      name: label.optional(),
      color: color.optional(),
      describeAs: z.string().max(2000).optional(),
    })
    .strict(),
  z.object({ op: z.literal("group.ungroup"), id }).strict(),
  z.object({ op: z.literal("shot.add"), name: label.optional() }).strict(),
  z.object({ op: z.literal("shot.save"), id }).strict(),
  z.object({ op: z.literal("shot.goto"), id }).strict(),
  z.object({ op: z.literal("shot.rename"), id, name: label }).strict(),
  z.object({ op: z.literal("shot.remove"), id }).strict(),
  z.object({ op: z.literal("camera_move.add"), presetId: id }).strict(),
  z
    .object({
      op: z.literal("camera_move.update"),
      id,
      startTime: seconds.optional(),
      duration: z.number().min(0.1).max(86400).optional(),
      amount: scalar.optional(),
      axis: z.enum(["x", "y", "xy"]).optional(),
      anchor: vector.optional(),
      lookAtAnchor: z.boolean().optional(),
      showAnchor: z.boolean().optional(),
      handheld: z.number().min(0).max(10).optional(),
      muted: z.boolean().optional(),
      easing: easing.optional(),
    })
    .strict(),
  z.object({ op: z.literal("camera_move.remove"), id }).strict(),
  z.object({ op: z.literal("camera_move.preset"), id, presetId: id }).strict(),
  z
    .object({
      op: z.literal("camera_move.reorder"),
      id,
      delta: z.number().int().min(-1000).max(1000),
    })
    .strict(),
  z
    .object({ op: z.literal("camera_move.lock_anchors"), locked: z.boolean() })
    .strict(),
  z
    .object({
      op: z.literal("camera_key.add"),
      id,
      localTimeSeconds: seconds,
      channels: z
        .array(z.enum(["position", "target", "fov"]))
        .min(1)
        .max(3)
        .optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("camera_key.move"),
      id,
      keyId: id,
      localTimeSeconds: seconds,
    })
    .strict(),
  z
    .object({
      op: z.literal("camera_key.update"),
      id,
      keyId: id,
      positionMeters: vector.optional(),
      targetMeters: vector.optional(),
      fovDegrees: z.number().min(12).max(90).optional(),
    })
    .strict(),
  z.object({ op: z.literal("camera_key.remove"), id, keyId: id }).strict(),
  z
    .object({ op: z.literal("camera_key.easing"), id, keyId: id, easing })
    .strict(),
  z
    .object({
      op: z.literal("amount_key.add"),
      id,
      localTimeSeconds: seconds,
      amount: scalar,
    })
    .strict(),
  z
    .object({
      op: z.literal("amount_key.move"),
      id,
      keyId: id,
      localTimeSeconds: seconds,
    })
    .strict(),
  z.object({ op: z.literal("amount_key.remove"), id, keyId: id }).strict(),
  z
    .object({ op: z.literal("amount_key.easing"), id, keyId: id, easing })
    .strict(),
  z
    .object({
      op: z.literal("timeline.set"),
      duration: z.number().min(0.1).max(600).optional(),
      fps: z.number().int().min(1).max(240).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("motion_key.add"),
      targetId: id,
      channel,
      timeSeconds: seconds,
    })
    .strict(),
  z
    .object({ op: z.literal("motion_key.remove"), targetId: id, keyId: id })
    .strict(),
  z
    .object({
      op: z.literal("motion_key.move"),
      targetId: id,
      keyId: id,
      timeSeconds: seconds,
    })
    .strict(),
  z
    .object({
      op: z.literal("motion_keys.shift"),
      keyIds: z.array(id).min(1).max(10000),
      deltaSeconds: z.number().min(-600).max(600),
    })
    .strict(),
  z
    .object({
      op: z.literal("motion_key.easing"),
      targetId: id,
      channel,
      keyId: id,
      easing,
    })
    .strict(),
  z
    .object({
      op: z.literal("motion_track.easing"),
      targetId: id,
      channel,
      easing,
    })
    .strict(),
  z
    .object({
      op: z.literal("occlusion_key.room_toggle"),
      roomId: id,
      face,
      timeSeconds: seconds,
    })
    .strict(),
  z
    .object({
      op: z.literal("occlusion_key.object_toggle"),
      objectId: id,
      timeSeconds: seconds,
    })
    .strict(),
  z
    .object({
      op: z.literal("occlusion_key.move"),
      trackId: id,
      keyId: id,
      timeSeconds: seconds,
    })
    .strict(),
  z
    .object({ op: z.literal("occlusion_key.remove"), trackId: id, keyId: id })
    .strict(),
  z
    .object({
      op: z.literal("layer.update"),
      targetId: id,
      start: seconds.optional(),
      end: seconds.optional(),
      hidden: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("glb.update"),
      id,
      ...transform,
      name: label.optional(),
      scale: z.number().min(0.001).max(1000).optional(),
      clipName: z.string().max(500).optional(),
      startTime: seconds.optional(),
      speed: z.number().min(0.01).max(100).optional(),
      visible: z.boolean().optional(),
      loop: z.boolean().optional(),
    })
    .strict(),
  z.object({ op: z.literal("glb.remove"), id }).strict(),
  z
    .object({
      op: z.literal("music.update"),
      offset: seconds.optional(),
      bpm: z.number().min(1).max(1000).optional(),
      barsPerSection: z.number().int().min(1).max(1000).optional(),
    })
    .strict(),
  z.object({ op: z.literal("music.split_bars") }).strict(),
  z.object({ op: z.literal("music.cut"), timeSeconds: seconds }).strict(),
  z.object({ op: z.literal("music.remove") }).strict(),
  z
    .object({
      op: z.literal("display.update"),
      showFloor: z.boolean().optional(),
      showLabels: z.boolean().optional(),
      showCharacterPaths: z.boolean().optional(),
      backgroundOn: z.boolean().optional(),
      roomAutoGrow: z.boolean().optional(),
      outerCutaway: z.boolean().optional(),
      foregroundZoom: z.number().min(0.1).max(10).optional(),
    })
    .strict(),
]);

export const compositionCommandsSchema = z
  .array(compositionCommandSchema)
  .min(1)
  .max(100);
export const compositionCommandsJsonSchema = z.toJSONSchema(
  compositionCommandsSchema,
);
export const COMPOSITION_COMMANDS = compositionCommandSchema.options.map(
  (option) => option.shape.op.value,
);
export type CompositionCommand = z.infer<typeof compositionCommandSchema>;

export class CompositionControlError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "CompositionControlError";
  }
}

export interface CompositionCommandContext {
  characterIds: readonly string[];
  imageIds?: readonly string[];
}

const radians = (v: Vector3Value): Vector3Value => ({
  x: (v.x * Math.PI) / 180,
  y: (v.y * Math.PI) / 180,
  z: (v.z * Math.PI) / 180,
});
function present<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
function requireId(exists: unknown, value: string) {
  if (!exists)
    throw new CompositionControlError(
      "not_found",
      `구도에서 대상을 찾지 못했습니다: ${value}`,
    );
}
function requireBone(bone: string) {
  requireId(
    EDITABLE_BONES.some((item) => item.id === bone),
    bone,
  );
}

/** 중간 실패가 UI에 절반만 남지 않게 모든 연산을 임시 판에서 계산한 뒤 한 번만 반영합니다. */
export function reduceCompositionCommands(
  current: CompositionState,
  input: unknown,
  context: CompositionCommandContext,
) {
  const parsed = compositionCommandsSchema.safeParse(input);
  if (!parsed.success)
    throw new CompositionControlError(
      "invalid_command",
      "구도 명령의 형식이나 범위가 맞지 않습니다.",
      parsed.error.issues,
    );
  let state = current;
  const created: { index: number; id: string }[] = [];
  for (const [index, command] of parsed.data.entries()) {
    const character = (value: string) =>
      requireId(
        state.characters.some((item) => item.characterId === value),
        value,
      );
    const object = (value: string) =>
      requireId(
        state.objects.some((item) => item.id === value),
        value,
      );
    const room = (value: string) =>
      requireId(
        edit.roomsOf(state).some((item) => item.id === value),
        value,
      );
    const move = (value: string) => {
      const item = edit.cameraMoveOf(state, value);
      requireId(item, value);
      return item!;
    };
    const target = (value: string) =>
      requireId(
        state.characters.some((item) => item.characterId === value) ||
          state.objects.some((item) => item.id === value) ||
          (state.glbTracks ?? []).some((item) => item.id === value),
        value,
      );
    const image = (value: string) => {
      if (value)
        requireId(
          context.imageIds?.includes(value) ||
            state.customBackgrounds.some((item) => item.id === value),
          value,
        );
    };
    const record = (next: { state: CompositionState; id: string | null }) => {
      state = next.state;
      if (next.id) created.push({ index, id: next.id });
    };
    switch (command.op) {
      case "camera.set": {
        state = edit.patchCameraIn(
          state,
          present({
            position: command.positionMeters,
            target: command.targetMeters,
            fovDegrees: command.fovDegrees,
          }),
        );
        break;
      }
      case "camera.speed":
        state = edit.setCameraSpeedIn(state, command.multiplier);
        break;
      case "room.add": {
        const made = edit.addRoomIn(state, command.kind);
        record(made);
        if (command.name)
          state = edit.renameRoomIn(state, made.id, command.name);
        break;
      }
      case "room.update": {
        room(command.id);
        if (command.name)
          state = edit.renameRoomIn(state, command.id, command.name);
        if (
          command.widthMeters !== undefined ||
          command.depthMeters !== undefined ||
          command.heightMeters !== undefined
        )
          state = edit.setRoomDimsIn(
            state,
            present({
              width: command.widthMeters,
              depth: command.depthMeters,
              height: command.heightMeters,
            }),
            command.id,
          );
        if (command.positionMeters || command.rotationDegrees !== undefined)
          state = edit.setRoomPlacementIn(
            state,
            command.id,
            present({
              ...command.positionMeters,
              rotationY: command.rotationDegrees,
            }),
          );
        if (command.hidden !== undefined)
          state = edit.setRoomHiddenIn(state, command.id, command.hidden);
        if (command.horizonColor) {
          if (
            !edit.roomsOf(state).find((item) => item.id === command.id)?.horizon
          )
            throw new CompositionControlError(
              "invalid_target",
              "호리존 방에만 호리존 색을 지정할 수 있습니다.",
            );
          state = edit.setRoomHorizonColorIn(
            state,
            command.id,
            command.horizonColor,
          );
        }
        if (command.outdoorShape) {
          if (
            !edit.roomsOf(state).find((item) => item.id === command.id)?.outdoor
          )
            throw new CompositionControlError(
              "invalid_target",
              "실외 방에만 돔·상자 형태를 지정할 수 있습니다.",
            );
          state = edit.setOutdoorShapeIn(
            state,
            command.id,
            command.outdoorShape,
          );
        }
        break;
      }
      case "room.select":
        room(command.id);
        state = edit.setActiveRoomIn(state, command.id);
        break;
      case "room.remove":
        room(command.id);
        state = edit.removeRoomIn(state, command.id);
        break;
      case "room.face":
        room(command.id);
        image(command.imageId);
        if (edit.roomsOf(state).find((item) => item.id === command.id)?.horizon)
          throw new CompositionControlError(
            "invalid_target",
            "호리존 방에는 이미지를 걸 수 없습니다.",
          );
        state = edit.setRoomFaceIn(
          state,
          command.face,
          command.imageId,
          command.shell,
          command.id,
        );
        break;
      case "room.panorama":
        room(command.id);
        image(command.imageId);
        state = edit.setRoomPanoramaIn(
          state,
          command.imageId,
          null,
          command.id,
        );
        break;
      case "room.occlusion":
        room(command.id);
        state = edit.setFaceOccludesIn(
          state,
          command.face,
          command.occludes,
          command.id,
        );
        break;
      case "room.face_ratio":
        room(command.id);
        state = edit.setRoomFaceRatioIn(
          state,
          command.ratio ?? undefined,
          command.id,
        );
        break;
      case "room.side_crop":
        room(command.id);
        state = edit.setRoomSideCropIn(state, command.fraction, command.id);
        break;
      case "character.place":
        requireId(context.characterIds.includes(command.id), command.id);
        state = state.characters.some((item) => item.characterId === command.id)
          ? edit.updateCharacterIn(state, command.id, { hidden: false })
          : edit.placeCharacterIn(state, command.id);
        break;
      case "character.update": {
        character(command.id);
        state = edit.updateCharacterIn(
          state,
          command.id,
          present({
            position: command.positionMeters,
            rotation:
              command.rotationDegrees && radians(command.rotationDegrees),
            pose: command.pose,
            hidden: command.hidden,
            heightCm: command.heightCm,
          }),
        );
        break;
      }
      case "character.color":
        command.ids.forEach(character);
        state = edit.setCharacterColorsIn(
          state,
          command.ids,
          command.color ?? undefined,
        );
        break;
      case "mannequin.add": {
        const next = edit.addMannequinIn(state, command.gender);
        const newId = next.mannequins.at(-1)!.id;
        state = command.name
          ? edit.patchMannequinIn(next, newId, { name: command.name })
          : next;
        created.push({ index, id: newId });
        break;
      }
      case "mannequin.remove":
        requireId(
          state.mannequins.some((item) => item.id === command.id),
          command.id,
        );
        state = edit.removeMannequinIn(state, command.id);
        break;
      case "mannequin.update": {
        requireId(
          state.mannequins.some((item) => item.id === command.id),
          command.id,
        );
        state = edit.patchMannequinIn(
          state,
          command.id,
          present({
            name: command.name,
            heightCm: command.heightCm,
            build: command.build,
          }),
        );
        break;
      }
      case "pose.bone":
        character(command.id);
        requireBone(command.bone);
        state = edit.setBoneRotationIn(
          state,
          command.id,
          command.bone,
          radians(command.rotationDegrees),
        );
        break;
      case "pose.finger":
        character(command.id);
        for (const [bone, rotation] of Object.entries(
          fingerStateToBonePose(command.side, command.finger, command.state),
        ))
          state = edit.setBoneRotationIn(state, command.id, bone, rotation);
        break;
      case "pose.reset":
        character(command.id);
        state = edit.updateCharacterIn(state, command.id, {
          bonePose: {},
          fingers: undefined,
        });
        break;
      case "object.add": {
        const entry = {
          id: command.kind,
          label: command.label,
          lightType: command.lightType,
        };
        if (command.roomId) {
          room(command.roomId);
          record(edit.addObjectInRoom(state, entry, command.roomId));
        } else {
          state = edit.addObjectIn(state, entry);
          created.push({ index, id: state.objects.at(-1)!.id });
        }
        break;
      }
      case "object.update": {
        object(command.id);
        const patch = present({
          position: command.positionMeters,
          rotation: command.rotationDegrees && radians(command.rotationDegrees),
          scale: command.scale,
          label: command.label,
          color: command.color,
          visible: command.visible,
          seeThrough: command.seeThrough,
          intensity: command.intensity,
          describeAs: command.describeAs,
        });
        state = command.wholeGroup
          ? edit.transformObjectGroupIn(state, command.id, patch)
          : edit.updateObjectIn(state, command.id, patch);
        break;
      }
      case "object.remove":
        object(command.id);
        state = edit.removeObjectIn(state, command.id);
        break;
      case "object.mount":
        object(command.id);
        room(command.roomId);
        state = edit.mountObjectToFaceIn(
          state,
          command.id,
          command.roomId,
          command.face,
        );
        break;
      case "object.attach":
        object(command.id);
        character(command.characterId);
        requireBone(command.bone);
        state = edit.attachObjectIn(state, command.id, {
          targetId: command.characterId,
          bone: command.bone,
        });
        break;
      case "object.detach":
        object(command.id);
        state = edit.detachObjectIn(state, command.id, {
          position: command.worldPositionMeters,
          rotation:
            command.worldRotationDegrees &&
            radians(command.worldRotationDegrees),
        });
        break;
      case "object.pivot":
        object(command.id);
        requireId(
          state.objects.find((item) => item.id === command.id)?.attach,
          command.id,
        );
        state = edit.setObjectPivotIn(
          state,
          command.id,
          command.positionMeters,
        );
        break;
      case "group.create":
        command.ids.forEach((value) =>
          requireId(
            state.objects.some((item) => item.id === value) ||
              edit.objectGroupsOf(state).some((item) => item.id === value),
            value,
          ),
        );
        record(edit.groupObjectsIn(state, command.ids, command.name));
        break;
      case "group.update": {
        requireId(
          edit.objectGroupsOf(state).some((item) => item.id === command.id),
          command.id,
        );
        state = edit.patchObjectGroupIn(
          state,
          command.id,
          present({
            name: command.name,
            color: command.color,
            describeAs: command.describeAs,
          }),
        );
        break;
      }
      case "group.ungroup":
        requireId(
          edit.objectGroupsOf(state).some((item) => item.id === command.id),
          command.id,
        );
        state = edit.ungroupObjectsIn(state, command.id);
        break;
      case "shot.add":
        record(edit.addCameraShotIn(state, command.name));
        break;
      case "shot.save":
      case "shot.goto":
      case "shot.rename":
      case "shot.remove":
        requireId(
          edit.cameraShotsOf(state).some((item) => item.id === command.id),
          command.id,
        );
        state =
          command.op === "shot.save"
            ? edit.saveCameraShotIn(state, command.id)
            : command.op === "shot.goto"
              ? edit.goToCameraShotIn(state, command.id)
              : command.op === "shot.rename"
                ? edit.renameCameraShotIn(state, command.id, command.name)
                : edit.removeCameraShotIn(state, command.id);
        break;
      case "camera_move.add":
        requireId(
          SHOT_PRESETS.some((item) => item.id === command.presetId),
          command.presetId,
        );
        record(edit.addCameraMoveIn(state, command.presetId));
        break;
      case "camera_move.update": {
        move(command.id);
        const { op: _op, id: _id, ...patch } = command;
        state = edit.patchCameraMoveIn(state, command.id, patch);
        break;
      }
      case "camera_move.remove":
        move(command.id);
        state = edit.removeCameraMoveIn(state, command.id);
        break;
      case "camera_move.preset":
        move(command.id);
        requireId(
          SHOT_PRESETS.some((item) => item.id === command.presetId),
          command.presetId,
        );
        state = edit.swapCameraMovePresetIn(
          state,
          command.id,
          command.presetId,
        );
        break;
      case "camera_move.reorder":
        move(command.id);
        state = edit.moveCameraMoveOrderIn(state, command.id, command.delta);
        break;
      case "camera_move.lock_anchors":
        state = edit.setLockAnchorsIn(state, command.locked);
        break;
      case "camera_key.add":
        if (command.localTimeSeconds > move(command.id).duration)
          throw new CompositionControlError(
            "invalid_time",
            "카메라 키의 시각이 클립 길이를 넘습니다.",
          );
        state = edit.addCameraKeyIn(
          state,
          command.id,
          command.localTimeSeconds,
          undefined,
          command.channels,
        );
        break;
      case "camera_key.remove":
      case "camera_key.easing":
        requireId(
          move(command.id).keys?.some((item) => item.id === command.keyId),
          command.keyId,
        );
        state =
          command.op === "camera_key.remove"
            ? edit.removeCameraKeyIn(state, command.id, command.keyId)
            : edit.setCameraKeyEasingIn(
                state,
                command.id,
                command.keyId,
                command.easing,
              );
        break;
      case "camera_key.move":
        requireId(
          move(command.id).keys?.some((item) => item.id === command.keyId),
          command.keyId,
        );
        if (command.localTimeSeconds > move(command.id).duration)
          throw new CompositionControlError(
            "invalid_time",
            "카메라 키의 시각이 클립 길이를 넘습니다.",
          );
        state = edit.moveCameraKeyIn(
          state,
          command.id,
          command.keyId,
          command.localTimeSeconds,
        );
        break;
      case "camera_key.update":
        requireId(
          move(command.id).keys?.some((item) => item.id === command.keyId),
          command.keyId,
        );
        state = edit.patchCameraKeyIn(
          state,
          command.id,
          command.keyId,
          present({
            position: command.positionMeters,
            target: command.targetMeters,
            fovScale:
              command.fovDegrees === undefined
                ? undefined
                : command.fovDegrees / state.camera.fovDegrees,
          }),
        );
        break;
      case "amount_key.add":
        if (command.localTimeSeconds > move(command.id).duration)
          throw new CompositionControlError(
            "invalid_time",
            "이동량 키의 시각이 클립 길이를 넘습니다.",
          );
        state = edit.addAmountKeyIn(
          state,
          command.id,
          command.localTimeSeconds,
          command.amount,
        );
        break;
      case "amount_key.move":
      case "amount_key.remove":
      case "amount_key.easing":
        requireId(
          move(command.id).amountKeys?.some(
            (item) => item.id === command.keyId,
          ),
          command.keyId,
        );
        if (command.op === "amount_key.move") {
          if (command.localTimeSeconds > move(command.id).duration)
            throw new CompositionControlError(
              "invalid_time",
              "이동량 키의 시각이 클립 길이를 넘습니다.",
            );
          state = edit.moveAmountKeyIn(
            state,
            command.id,
            command.keyId,
            command.localTimeSeconds,
          );
        } else
          state =
            command.op === "amount_key.remove"
              ? edit.removeAmountKeyIn(state, command.id, command.keyId)
              : edit.setAmountKeyEasingIn(
                  state,
                  command.id,
                  command.keyId,
                  command.easing,
                );
        break;
      case "timeline.set":
        state = edit.setTimelineIn(
          state,
          present({ duration: command.duration, fps: command.fps }),
        );
        break;
      case "motion_key.add":
        target(command.targetId);
        if (command.channel === "pose") character(command.targetId);
        else if (!edit.motionValueOf(state, command.targetId, command.channel))
          throw new CompositionControlError(
            "unsupported_channel",
            "이 대상은 해당 동작 키를 지원하지 않습니다. 인물의 크기는 키(cm)로 정합니다.",
          );
        if (command.timeSeconds > edit.timelineOf(state).duration)
          throw new CompositionControlError(
            "invalid_time",
            "동작 키의 시각이 타임라인 길이를 넘습니다.",
          );
        state = edit.addMotionKeyIn(
          state,
          command.targetId,
          command.channel,
          command.timeSeconds,
        );
        break;
      case "motion_key.remove":
      case "motion_key.easing": {
        requireId(
          edit
            .motionTracksOf(state)
            .some(
              (track) =>
                track.targetId === command.targetId &&
                (command.op === "motion_key.remove" ||
                  track.channel === command.channel) &&
                track.keys.some((key) => key.id === command.keyId),
            ),
          command.keyId,
        );
        state =
          command.op === "motion_key.remove"
            ? edit.removeMotionKeyIn(state, command.targetId, command.keyId)
            : edit.setMotionKeyEasingIn(
                state,
                command.targetId,
                command.channel,
                command.keyId,
                command.easing,
              );
        break;
      }
      case "motion_key.move":
        requireId(
          edit
            .motionTracksOf(state)
            .some(
              (track) =>
                track.targetId === command.targetId &&
                track.keys.some((key) => key.id === command.keyId),
            ),
          command.keyId,
        );
        state = edit.moveMotionKeyIn(
          state,
          command.targetId,
          command.keyId,
          command.timeSeconds,
        );
        break;
      case "motion_keys.shift":
        command.keyIds.forEach((keyId) =>
          requireId(
            edit
              .motionTracksOf(state)
              .some((track) => track.keys.some((key) => key.id === keyId)),
            keyId,
          ),
        );
        state = edit.shiftMotionKeysIn(
          state,
          command.keyIds,
          command.deltaSeconds,
        );
        break;
      case "motion_track.easing":
        requireId(
          edit
            .motionTracksOf(state)
            .some(
              (track) =>
                track.targetId === command.targetId &&
                track.channel === command.channel,
            ),
          command.targetId,
        );
        state = edit.setMotionEasingIn(
          state,
          command.targetId,
          command.channel,
          command.easing,
        );
        break;
      case "occlusion_key.room_toggle":
        room(command.roomId);
        state = edit.toggleOccludeKeyIn(
          state,
          command.roomId,
          command.face,
          command.timeSeconds,
        );
        break;
      case "occlusion_key.object_toggle":
        object(command.objectId);
        state = edit.toggleObjectSeeThroughKeyIn(
          state,
          command.objectId,
          command.timeSeconds,
        );
        break;
      case "occlusion_key.move":
      case "occlusion_key.remove":
        requireId(
          edit
            .occludeTracksOf(state)
            .some(
              (track) =>
                track.id === command.trackId &&
                track.keys.some((key) => key.id === command.keyId),
            ),
          command.keyId,
        );
        state =
          command.op === "occlusion_key.move"
            ? edit.moveOccludeKeyIn(
                state,
                command.trackId,
                command.keyId,
                command.timeSeconds,
              )
            : edit.removeOccludeKeyIn(state, command.trackId, command.keyId);
        break;
      case "layer.update":
        target(command.targetId);
        if (command.start !== undefined || command.end !== undefined)
          state = edit.setLayerSpanIn(
            state,
            command.targetId,
            present({ start: command.start, end: command.end }),
          );
        if (command.hidden !== undefined)
          state = edit.setLayerHiddenIn(
            state,
            command.targetId,
            command.hidden,
          );
        break;
      case "glb.update": {
        const track = state.glbTracks?.find((item) => item.id === command.id);
        requireId(track, command.id);
        if (command.clipName && !track!.clips?.includes(command.clipName))
          throw new CompositionControlError(
            "invalid_clip",
            "아직 확인되지 않은 GLB 애니메이션입니다.",
          );
        const {
          op: _op,
          id: _id,
          positionMeters,
          rotationDegrees,
          ...patch
        } = command;
        state = edit.updateGlbIn(
          state,
          command.id,
          present({
            ...patch,
            position: positionMeters,
            rotation: rotationDegrees && radians(rotationDegrees),
          }),
        );
        break;
      }
      case "glb.remove":
        requireId(
          state.glbTracks?.some((item) => item.id === command.id),
          command.id,
        );
        state = edit.removeGlbIn(state, command.id);
        break;
      case "music.update": {
        requireId(edit.musicOf(state), "음악");
        const { op: _op, ...patch } = command;
        state = edit.patchMusicIn(state, patch);
        break;
      }
      case "music.split_bars": {
        const music = edit.musicOf(state);
        requireId(music, "음악");
        state = edit.splitMusicByBarsIn(
          state,
          music!.bpm ?? 120,
          music!.barsPerSection ?? 4,
        );
        break;
      }
      case "music.cut":
        requireId(edit.musicOf(state), "음악");
        state = edit.cutMusicAtIn(state, command.timeSeconds);
        break;
      case "music.remove":
        state = edit.setMusicIn(state, null);
        break;
      case "display.update": {
        const { op: _op, ...patch } = command;
        state = { ...state, ...patch };
        break;
      }
    }
  }
  // 내용이 같은 명령도 새 참조를 만들면 GLB가 다시 로드될 수 있습니다. 원래 판을 그대로 지킵니다.
  return {
    state: JSON.stringify(state) === JSON.stringify(current) ? current : state,
    created,
  };
}
