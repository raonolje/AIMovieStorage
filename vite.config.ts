import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * 설정 원본은 사고로 잃었습니다. 남은 단서로 다시 세운 것입니다.
 *
 * - tauri.conf.json 이 devUrl 을 127.0.0.1:3000 으로, frontendDist 를
 * ../dist/public 으로 가리키고 있어서 여기 포트와 출력 경로를 그대로 맞췄습니다.
 * - 별칭은 tsconfig.json 의 paths 와 같아야 합니다. 한쪽만 고치면
 * 편집기에서는 되는데 빌드에서 깨집니다.
 * - 마누스 전용 플러그인(vite-plugin-manus-runtime, jsx-loc)은 뺐습니다.
 * 그 환경을 떠났고, 없어도 앱은 그대로 돕니다.
 */
const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * **pdf.js 의 CMap 과 표준 글꼴 표를 앱과 함께 둡니다** (`/pdfjs/…`).
 *
 * 사용자의 시나리오는 **한국어 PDF** 입니다. 한글 PDF 는 대개 `UniKS-UCS2-H` 같은
 * «미리 정해진 CMap» 으로 글자를 가리키는데, 그 표가 없으면 pdf.js 가 글리프 번호를
 * 글자로 못 바꿔 **빈 글이나 깨진 글자**가 나옵니다. 표준 글꼴 표(`standard_fonts`)도
 * 같은 이유로 필요합니다 — 글꼴이 안 박힌 PDF 에서 글자 매김이 그것에 기댑니다.
 *
 * 2.3 MB 쯤 되지만 **JS 번들에는 안 들어갑니다.** 정적 파일로 두고 그 PDF 가 실제로
 * 필요로 할 때만 받아 갑니다. 그래서 `node_modules` 에서 복사만 합니다 — 저장소에
 * 넣어 두면 pdfjs 를 올릴 때마다 손으로 갱신해야 하고, 잊으면 조용히 옛 표를 씁니다.
 */
function pdfjsAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const base = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const dirs = ["cmaps", "standard_fonts"];
  return {
    name: "pdfjs-assets",
    // 개발 서버에서는 복사하지 않고 그 자리에서 읽어 줍니다.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const hit = /^\/pdfjs\/(cmaps|standard_fonts)\/([\w.-]+)$/.exec(
          (req.url || "").split("?")[0],
        );
        if (!hit) return next();
        const file = path.join(base, hit[1], hit[2]);
        if (!fs.existsSync(file)) return next();
        res.setHeader("Content-Type", "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const dir of dirs) {
        const from = path.join(base, dir);
        if (!fs.existsSync(from)) continue;
        for (const name of fs.readdirSync(from)) {
          this.emitFile({
            type: "asset",
            fileName: `pdfjs/${dir}/${name}`,
            source: fs.readFileSync(path.join(from, name)),
          });
        }
      }
    },
  };
}

export default defineConfig({
  /*
    시험은 **우리 소스만** 돕니다. `scratch/` 에 헤드리스 크롬 프로필이 떨어지면(.gitignore 참조) 그 안의
    확장 프로그램 `*.spec.js` 여든 개를 vitest 가 주워 `jest is not defined` 로 전부 실패했습니다
    (2026-09-22 실측). 저장소 밖 파일이 우리 시험을 빨갛게 만들면 안 됩니다.
  */
  test: { include: ["client/src/**/*.test.ts"],globalSetup:["./scripts/comfy-workflow-test-fixtures.mjs"] },
  plugins: [react(), tailwindcss(), pdfjsAssets()],
  root: fileURLToPath(new URL("./client", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./client/src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/public", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        /*
          three.js 를 별 청크로 갈라 둡니다.

          앱 전체가 1.75 MB 한 덩어리였고 그 절반 가까이가 three.js 였습니다.
          three.js 는 구도잡기 창에서만 쓰이는데 앱 코드 한 줄을 고칠 때마다 그
          덩어리가 통째로 새 해시를 받아, 바뀐 것이 없는 three.js 까지 다시
          받았습니다. 갈라 두면 three.js 청크는 버전을 올리기 전까지 그대로라
          캐시가 맞고, 앱 청크만 작게 다시 받습니다.

          three/examples(OrbitControls·GLTFLoader 등)도 같은 청크에 둡니다. 따로
          두면 둘이 함께 쓰는 코드가 세 번째 청크로 갈라져 요청만 늘어납니다.
          경로 구분자는 윈도(\)와 리눅스(/) 둘 다 받습니다 — 여기서는 윈도에서
          빌드하지만, 한쪽만 보면 다른 쪽에서 조용히 안 갈라집니다.
        */
        manualChunks(id) {
          if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) return "three";
          return undefined;
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
  // Tauri 가 창 안에서 띄우므로 브라우저를 따로 열 필요가 없습니다.
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
});
