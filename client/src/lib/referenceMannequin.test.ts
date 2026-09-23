import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { referenceMannequinMaterials, REFERENCE_MANNEQUIN_COLOR } from "./referenceMannequin";

describe("레퍼런스 영상의 몸 색", () => {
  it("공유 원본·배경을 물들이지 않고 영상 뒤에 같은 재질과 텍스처를 돌려놓는다", () => {
    const map = new THREE.Texture();
    const original = new THREE.MeshStandardMaterial({ color: "#d46fb0", map, emissive: "#ff0000", vertexColors: true });
    const body = new THREE.Mesh(new THREE.BoxGeometry(), original);
    const other = new THREE.Mesh(new THREE.BoxGeometry(), original);
    const savedColor = original.color.getHex();
    const palette = referenceMannequinMaterials();
    palette.apply([body]);
    const copy = body.material as THREE.MeshStandardMaterial;
    const disposed = vi.spyOn(copy, "dispose");
    expect(copy.color.getHex()).toBe(new THREE.Color(REFERENCE_MANNEQUIN_COLOR).getHex());
    expect(copy.map).toBeNull();
    expect(copy.vertexColors).toBe(false);
    expect(copy.emissive.getHex()).toBe(0);
    expect(other.material).toBe(original);
    expect(original.color.getHex()).toBe(savedColor);
    expect(original.map).toBe(map);
    palette.apply([body]);
    expect(body.material).toBe(copy);
    palette.restore();
    expect(body.material).toBe(original);
    expect(disposed).toHaveBeenCalledTimes(1);
    palette.restore();
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it("영상 중 늦게 읽은 인물도 적용하고 다중 재질·헬퍼의 원래 상태를 보존한다", () => {
    const root = new THREE.Group();
    const palette = referenceMannequinMaterials();
    palette.apply([root]);
    const materials = [new THREE.MeshStandardMaterial({ color: "red" }), new THREE.MeshBasicMaterial({ color: "blue" })];
    const body = new THREE.Mesh(new THREE.BoxGeometry(), materials);
    const helper = new THREE.Mesh(new THREE.BoxGeometry(), materials);
    helper.userData.helper = true;
    root.add(body, helper);
    palette.apply([root]);
    expect(body.material).not.toBe(materials);
    expect(helper.material).toBe(materials);
    palette.restore();
    expect(body.material).toBe(materials);
  });
});
