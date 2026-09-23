import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/** 판·이름·위치를 여기서 같이 정해야 설치본과 업데이트가 서로 다른 파일을 집지 않습니다. */
export function buildLayout(root, edition, targetBase) {
  if (!["private", "public"].includes(edition))
    throw new Error(`모르는 판입니다: ${edition}`);
  const conf = JSON.parse(
    readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const cargo = readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
  const binary = /\[\[bin\]\][\s\S]*?name\s*=\s*"([^"]+)"/.exec(cargo)?.[1];
  if (!binary) throw new Error("Cargo.toml 에 실행 파일 이름이 없습니다.");
  const productName =
    edition === "public" ? `${conf.productName}-Public` : conf.productName;
  const targetDir = path.join(
    path.resolve(targetBase || path.join(root, "src-tauri/target")),
    edition,
  );
  const releaseDir = path.join(targetDir, "release");
  const stem = `${productName}_${conf.version}_x64`;
  return {
    root,
    edition,
    version: conf.version,
    productName,
    targetDir,
    releaseDir,
    executable: `${binary}.exe`,
    installer: `${stem}-setup.exe`,
    portable: `${stem}-portable.zip`,
    manifestPath: path.join(releaseDir, "bundle/build-manifest.json"),
  };
}

/** 입력에 .. 나 절대 경로가 섞이면 다른 폴더를 읽거나 지우기 전에 멈춥니다. */
export function inside(parent, relative) {
  const result = path.resolve(parent, relative);
  const fromParent = path.relative(path.resolve(parent), result);
  if (
    !fromParent ||
    fromParent === ".." ||
    fromParent.startsWith(`..${path.sep}`) ||
    path.isAbsolute(fromParent)
  ) {
    throw new Error(`작업 폴더 밖의 경로입니다: ${relative}`);
  }
  return result;
}

export function fileHash(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function engineIdOf(resource) {
  return (
    /\/engines\/([^/]+?)(?:\.py)?(?:\/|$)/.exec(
      resource.replace(/\\/g, "/"),
    )?.[1] ?? null
  );
}

/** 소스·설치본·무설치본이 같은 허용 목록을 써야 예전 비공개 리소스가 끼지 않습니다. */
export function bundleResources(root, edition) {
  const tauriDir = path.join(root, "src-tauri");
  const conf = JSON.parse(
    readFileSync(path.join(tauriDir, "tauri.conf.json"), "utf8"),
  );
  const rules = JSON.parse(
    readFileSync(path.join(root, "edition.json"), "utf8"),
  );
  const excluded = edition === "public" ? rules.public.excludeEngines : [];
  const kept = new Set();
  const dropped = new Set();
  for (const pattern of conf.bundle.resources) {
    const normalized = pattern.replace(/\\/g, "/");
    const segments = normalized.split("/");
    const firstGlob = segments.findIndex((segment) => segment.includes("*"));
    const files = [];
    if (firstGlob < 0) {
      if (!existsSync(inside(tauriDir, normalized)))
        throw new Error(`번들 파일이 없습니다: ${normalized}`);
      files.push(normalized);
    } else {
      const base = segments.slice(0, firstGlob).join("/");
      const regex = new RegExp(
        "^" +
          normalized
            .replace(/[.+^${}()|\\]/g, "\\$&")
            .replace(/\*\*\//g, "\0")
            .replace(/\*\*/g, "\0")
            .replace(/\*/g, "[^/]*")
            .replace(/\0/g, "(?:.*/)?") +
          "$",
      );
      const walk = (relative) => {
        const absolute = inside(tauriDir, relative);
        if (!existsSync(absolute)) return;
        inside(
          realpathSync(tauriDir),
          path.relative(realpathSync(tauriDir), realpathSync(absolute)),
        );
        for (const name of readdirSync(absolute).sort()) {
          const child = `${relative}/${name}`;
          if (statSync(inside(tauriDir, child)).isDirectory()) walk(child);
          else if (regex.test(child)) files.push(child);
        }
      };
      walk(base);
    }
    for (const file of files) {
      inside(
        realpathSync(tauriDir),
        path.relative(
          realpathSync(tauriDir),
          realpathSync(inside(tauriDir, file)),
        ),
      );
      (excluded.includes(engineIdOf(file)) ? dropped : kept).add(file);
    }
  }
  return { kept: [...kept].sort(), dropped: [...dropped].sort() };
}

/** 빈 stage 에 명시한 리소스만 옮깁니다. 빌드 폴더에 남은 파일 전체를 복사하지 않습니다. */
export function stagePortable(
  layout,
  stage,
  resources = bundleResources(layout.root, layout.edition).kept,
) {
  checkResourceList(layout, resources);
  inside(layout.releaseDir, path.relative(layout.releaseDir, stage));
  if (!existsSync(stage) || readdirSync(stage).length)
    throw new Error("무설치본 작업 폴더는 비어 있어야 합니다.");
  const executable = inside(layout.releaseDir, layout.executable);
  cpSync(executable, inside(stage, layout.executable));
  for (const relative of resources) {
    const source = inside(path.join(layout.root, "src-tauri"), relative);
    const built = inside(layout.releaseDir, relative);
    if (!existsSync(built))
      throw new Error(`빌드한 리소스가 없습니다: ${relative}`);
    if (fileHash(source) !== fileHash(built))
      throw new Error(`빌드한 리소스가 소스와 다릅니다: ${relative}`);
    const to = inside(stage, relative);
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(built, to);
  }
}

const artifactPaths = (layout) => ({
  executable: layout.executable,
  installer: `bundle/nsis/${layout.installer}`,
  portable: `bundle/portable/${layout.portable}`,
});

function checkResourceList(layout, resources) {
  const expected = bundleResources(layout.root, layout.edition).kept;
  if (JSON.stringify(resources) !== JSON.stringify(expected)) {
    throw new Error("리소스 목록이 현재 판과 다릅니다.");
  }
}

/** 폴더를 훑어 첫 파일을 고르지 않고 이번 빌드의 정확한 산출물과 해시를 남깁니다. */
export function writeBuildManifest(layout, resources) {
  checkResourceList(layout, resources);
  const artifacts = Object.fromEntries(
    Object.entries(artifactPaths(layout)).map(([kind, relative]) => {
      const file = inside(layout.releaseDir, relative);
      return [
        kind,
        { path: relative, bytes: statSync(file).size, sha256: fileHash(file) },
      ];
    }),
  );
  const manifest = {
    schemaVersion: 1,
    edition: layout.edition,
    version: layout.version,
    platform: "windows-x86_64",
    productName: layout.productName,
    artifacts,
    resources: resources.map((relative) => ({
      path: relative,
      sha256: fileHash(inside(layout.releaseDir, relative)),
    })),
  };
  mkdirSync(path.dirname(layout.manifestPath), { recursive: true });
  writeFileSync(layout.manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

export function readBuildManifest(layout) {
  const manifest = JSON.parse(readFileSync(layout.manifestPath, "utf8"));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.edition !== layout.edition ||
    manifest.version !== layout.version ||
    manifest.productName !== layout.productName ||
    manifest.platform !== "windows-x86_64"
  ) {
    throw new Error("빌드 명세의 판·버전·플랫폼이 이번 배포와 다릅니다.");
  }
  for (const [kind, expected] of Object.entries(artifactPaths(layout))) {
    const artifact = manifest.artifacts?.[kind];
    if (artifact?.path !== expected)
      throw new Error(`빌드 명세의 파일 이름이 다릅니다: ${kind}`);
    const file = inside(layout.releaseDir, artifact.path);
    if (
      statSync(file).size !== artifact.bytes ||
      fileHash(file) !== artifact.sha256
    ) {
      throw new Error(`빌드 뒤 산출물이 바뀌었습니다: ${kind}`);
    }
  }
  const expectedResources = bundleResources(layout.root, layout.edition).kept;
  if (
    !Array.isArray(manifest.resources) ||
    JSON.stringify(manifest.resources.map((item) => item.path)) !==
      JSON.stringify(expectedResources)
  ) {
    throw new Error("빌드 명세의 리소스 목록이 현재 판과 다릅니다.");
  }
  for (const resource of manifest.resources) {
    if (
      fileHash(inside(layout.releaseDir, resource.path)) !== resource.sha256 ||
      fileHash(inside(path.join(layout.root, "src-tauri"), resource.path)) !==
        resource.sha256
    ) {
      throw new Error(`빌드 뒤 리소스가 바뀌었습니다: ${resource.path}`);
    }
  }
  return manifest;
}
