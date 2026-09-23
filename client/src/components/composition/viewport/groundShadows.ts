import * as THREE from "three";
import type { CompositionState } from "@/lib/composition";
import { contactOpacity, shadowsOf } from "@/lib/compositionShadows";
import { boneOf } from "@/lib/rig";

/** 사진에 이미 들어 있는 조명을 흉내 내지 않고, 발의 접지만 약하게 알려 주는 근사 그늘입니다. */
export function createGroundShadows(foreground: THREE.Group) {
  const group = new THREE.Group();
  group.name = "contact-shadows";
  foreground.add(group);
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const meshes = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>>();
  const footPoint = new THREE.Vector3();
  const toePoint = new THREE.Vector3();

  function meshOf(id: string) {
    let mesh = meshes.get(id);
    if (!mesh) {
      const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, toneMapped: false,
        uniforms: { opacity: { value: 0 }, softness: { value: 0.65 } },
        vertexShader: "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
        fragmentShader: "varying vec2 vUv; uniform float opacity; uniform float softness; void main(){float r=length(vUv*2.0-1.0);float a=(1.0-smoothstep(0.65*(1.0-softness),1.0,r))*opacity;if(a<0.001)discard;gl_FragColor=vec4(0.0,0.0,0.0,a);}",
      });
      mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 1;
      meshes.set(id, mesh);
      group.add(mesh);
    }
    return mesh;
  }

  return {
    group,
    /** 재생과 정지 그림·영상 캡처가 모두 렌더 직전에 같은 발 좌표를 사용합니다. */
    update(composition: CompositionState, roots: Map<string, THREE.Group>, rigs: Map<string, THREE.Object3D>) {
      const settings = shadowsOf(composition);
      group.visible = settings.resolvedMode === "contact";
      if (!group.visible) return;
      const live = new Set<string>();
      for (const [id, root] of roots) {
        const rig = rigs.get(id);
        if (!root.visible || !rig) continue;
        for (const side of ["Left", "Right"] as const) {
          const foot = boneOf(rig, `${side}Foot`);
          if (!foot) continue;
          const key = `${id}:${side}`;
          live.add(key);
          const mesh = meshOf(key);
          foot.getWorldPosition(footPoint);
          foreground.worldToLocal(footPoint);
          const toe = boneOf(rig, `${side}ToeBase`);
          if (toe) {
            toe.getWorldPosition(toePoint);
            foreground.worldToLocal(toePoint);
          } else toePoint.copy(footPoint).add(new THREE.Vector3(0, 0, 0.15));
          // 이 구도 공간의 수평 바닥은 y=0입니다. 공중의 발 아래를 진하게 찍지 않습니다.
          const height = Math.min(footPoint.y, toePoint.y);
          mesh.position.set((footPoint.x + toePoint.x) / 2, 0.004, (footPoint.z + toePoint.z) / 2);
          mesh.rotation.y = Math.atan2(toePoint.x - footPoint.x, toePoint.z - footPoint.z);
          const length = Math.max(0.12, Math.min(0.5, footPoint.distanceTo(toePoint)));
          const spread = 0.1 + settings.softness * 0.16;
          mesh.scale.set(length + spread, 1, length * 1.8 + spread);
          mesh.material.uniforms.opacity.value = contactOpacity(height, settings.strength);
          mesh.material.uniforms.softness.value = settings.softness;
          mesh.visible = mesh.material.uniforms.opacity.value > 0;
        }
      }
      // 삭제·숨김·구도 전환 때 앞선 사람의 그늘이 바닥에 남지 않게 합니다.
      for (const [key, mesh] of meshes) if (!live.has(key)) {
        mesh.removeFromParent();
        mesh.material.dispose();
        meshes.delete(key);
      }
    },
    dispose() {
      group.removeFromParent();
      meshes.forEach(mesh => mesh.material.dispose());
      meshes.clear();
      geometry.dispose();
    },
  };
}
