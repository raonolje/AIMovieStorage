import * as THREE from "three";

export const REFERENCE_MANNEQUIN_COLOR = "#909090";

/** 영상에는 구분용 몸 색을 싣지 않습니다. 편집 화면·구도 이미지의 색 이름표는 그대로 둡니다. */
export function referenceMannequinMaterials() {
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const copies = new Set<THREE.Material>();
  return {
    apply(roots: Iterable<THREE.Object3D>) {
      for (const root of roots) root.traverse((node) => {
        if (!(node instanceof THREE.Mesh) || node.userData.helper || originals.has(node)) return;
        const original = node.material;
        originals.set(node, original);
        const neutral = (material: THREE.Material) => {
          const copy = material.clone() as THREE.MeshStandardMaterial;
          if (copy.color) copy.color.set(REFERENCE_MANNEQUIN_COLOR);
          if (copy.emissive) copy.emissive.set(0x000000);
          // 모델의 텍스처·정점 색도 몸에 남을 수 있으므로 영상용 복제본에서만 끕니다.
          if ("map" in copy) copy.map = null;
          if ("emissiveMap" in copy) copy.emissiveMap = null;
          copy.vertexColors = false;
          copies.add(copy);
          return copy;
        };
        node.material = Array.isArray(original) ? original.map(neutral) : neutral(original);
      });
    },
    restore() {
      for (const [mesh, material] of originals) mesh.material = material;
      for (const material of copies) material.dispose();
      originals.clear();
      copies.clear();
    },
  };
}
