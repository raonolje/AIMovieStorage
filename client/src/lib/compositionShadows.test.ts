import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { DEFAULT_COMPOSITION, normalizeComposition, normalizeCompositionRoom } from "./composition";
import { contactOpacity, normalizeShadows, shadowsOf } from "./compositionShadows";
import { createGroundShadows } from "@/components/composition/viewport/groundShadows";

describe("바닥 격자와 그림자의 저장·재생", () => {
  it("옛 바닥 숨김은 한 번만 이행하고 새 그림자는 격자를 꺼도 남는다", () => {
    const old = normalizeComposition({ showFloor: false });
    expect(old.shadows?.mode).toBe("off");
    const modern = normalizeComposition({ ...old, shadows: { mode: "contact", strength: 0.4, softness: 0.8 } });
    expect(shadowsOf(modern).resolvedMode).toBe("contact");
    expect(normalizeComposition(JSON.parse(JSON.stringify(modern))).shadows).toEqual(modern.shadows);
    expect(shadowsOf({ ...modern, showFloor: true }).resolvedMode).toBe("contact");
  });

  it("자동은 보이는 사진 방에만 접지 그늘을 쓰고 명시한 모드를 덮지 않는다", () => {
    const photo = normalizeCompositionRoom({ faces: { bottom: "floor.png" } });
    const state = { ...DEFAULT_COMPOSITION, rooms: [photo] };
    expect(shadowsOf(state).resolvedMode).toBe("contact");
    expect(shadowsOf({ ...state, rooms: [{ ...photo, hidden: true }] }).resolvedMode).toBe("directional");
    expect(shadowsOf({ ...state, backgroundOn: false }).resolvedMode).toBe("directional");
    expect(shadowsOf({ ...state, shadows: { mode: "directional", strength: 0.4, softness: 0.5 } }).resolvedMode).toBe("directional");
  });

  it("명시한 0과 꺼짐을 보존하고 손상된 수치는 유한한 범위로 정리한다", () => {
    expect(normalizeShadows({ mode: "contact", strength: 0, softness: 0 })).toEqual({ mode: "contact", strength: 0, softness: 0 });
    expect(normalizeShadows({ strength: NaN, softness: Infinity })).toEqual({ mode: "auto", strength: 0.32, softness: 0.65 });
    expect(normalizeShadows({ strength: 3, softness: -2 })).toEqual({ mode: "auto", strength: 1, softness: 0 });
    expect(shadowsOf({ ...DEFAULT_COMPOSITION, shadows: { mode: "contact", strength: 0, softness: 0 } }).resolvedMode).toBe("off");
    expect(contactOpacity(1, 0.5)).toBe(0);
    expect(contactOpacity(0.3, 0.5)).toBeLessThan(contactOpacity(0, 0.5));
  });

  it("실제 본 좌표를 따라 움직이고, 떠 있는 발·숨긴 인물의 이전 그늘이 남지 않는다", () => {
    const foreground = new THREE.Group();
    foreground.scale.setScalar(2);
    foreground.position.x = 3;
    const figure = new THREE.Group();
    const rig = new THREE.Group();
    figure.add(rig); foreground.add(figure);
    const foot = new THREE.Bone(); foot.name = "mixamorigLeftFoot"; foot.position.set(-0.1, 0.06, 0);
    const toe = new THREE.Bone(); toe.name = "mixamorigLeftToeBase"; toe.position.set(0, -0.04, 0.15);
    foot.add(toe); rig.add(foot);
    const roots = new Map([["p", figure]]), rigs = new Map<string, THREE.Object3D>([["p", rig]]);
    const state = { ...DEFAULT_COMPOSITION, showFloor: false, shadows: { mode: "contact" as const, strength: 0.4, softness: 0.8 } };
    const shadows = createGroundShadows(foreground);
    shadows.update(state, roots, rigs);
    const mesh = shadows.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    expect(mesh.position.x).toBeCloseTo(-0.1);
    expect(mesh.material.uniforms.opacity.value).toBe(0.4);
    figure.position.x = 2;
    shadows.update(state, roots, rigs);
    expect(mesh.position.x).toBeCloseTo(1.9);
    foot.position.y = 1;
    shadows.update(state, roots, rigs);
    expect(mesh.visible).toBe(false);
    const disposed = vi.spyOn(mesh.material, "dispose");
    figure.visible = false;
    shadows.update(state, roots, rigs);
    expect(shadows.group.children).toHaveLength(0);
    expect(disposed).toHaveBeenCalledOnce();
    shadows.dispose();
    expect(shadows.group.parent).toBeNull();
  });
});
