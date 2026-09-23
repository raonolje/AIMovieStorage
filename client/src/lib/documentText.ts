/**
 * **글 파일에서 글자를 뽑습니다** — PDF · 워드(docx) · 텍스트.
 *
 * # 왜 붙여넣기만으로는 모자란가
 *
 * 시나리오·기획안은 대개 **이미 파일로** 있습니다. 한글 프로그램·워드에서 긁어 붙이면
 * 표가 무너지고 줄바꿈이 뭉개집니다. 무엇보다 30쪽짜리 대본을 스크롤해 가며 긁는 것이
 * 일입니다. 파일을 그대로 던지면 되게 합니다.
 *
 * # 뽑은 글은 **사람이 보는 칸에 들어갑니다**
 *
 * 몰래 LLM 에 바로 보내지 않습니다. 시나리오 칸에 글로 채워 넣어서, **무엇을 읽었는지
 * 눈으로 확인하고 고친 뒤** 「만들기」 를 누르게 합니다. PDF 는 쪽번호·머리말이 같이
 * 딸려 오는 일이 잦은데, 그것을 모른 채 보내면 인물 이름이 엉뚱하게 잡힙니다.
 *
 * # 무거운 라이브러리는 **누를 때** 받습니다
 *
 * `pdfjs-dist` 와 `mammoth` 는 합쳐서 수 MB 라, 위에서 import 하면 앱을 켤 때마다
 * 그만큼 더 읽습니다. 파일을 실제로 고른 사람만 부담하도록 `await import(...)` 로
 * 그 자리에서 받습니다.
 */

// Vite 가 워커를 따로 뽑아 주소만 돌려줍니다 — 여기서는 문자열 하나라 번들이 안 커집니다.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/** 이 앱이 읽을 수 있는 확장자. 파일 고르개의 `accept` 와 안내문이 같이 씁니다. */
export const DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".markdown",
  ".rtf",
  ".csv",
  ".json",
] as const;

export const DOCUMENT_ACCEPT = DOCUMENT_EXTENSIONS.join(",");

export interface DocumentText {
  /** 뽑아낸 글. 앞뒤 빈 줄은 정리돼 있습니다. */
  text: string;
  /** PDF 면 쪽 수. 다른 갈래는 없습니다 — 「몇 쪽을 읽었나」 를 보여 주려고. */
  pages?: number;
}

/** 확장자(점 포함, 소문자). 이름에 점이 없으면 빈 문자열. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

/**
 * 줄바꿈을 정리합니다.
 *
 * PDF 에서 뽑은 글은 **한 줄이 문장 하나가 아닙니다** — 쪽 폭에서 잘린 자리마다
 * 줄이 끊깁니다. 빈 줄 세 개 이상은 둘로 줄이고, 줄 끝 공백은 뗍니다. 문장을 이어
 * 붙이지는 않습니다 — 대본은 줄바꿈 자체가 뜻(화자·지문)이라 함부로 이으면 망가집니다.
 */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * RTF 에서 글자만 건집니다.
 *
 * 제대로 된 파서를 붙일 만큼 자주 쓰이진 않지만, 「다른 이름으로 저장」 에서 흔히
 * 나오는 갈래라 **아예 못 읽는 것보다는** 제어어를 걷어 낸 글이 낫습니다.
 */
function fromRtf(raw: string): string {
  return tidy(
    raw
      // `\'ed` 같은 16진 이스케이프와 제어어를 걷어냅니다.
      .replace(/\\'[0-9a-f]{2}/gi, "")
      .replace(/\\par[d]?\b/g, "\n")
      .replace(/\\[a-z]+-?\d* ?/gi, "")
      .replace(/[{}]/g, ""),
  );
}

/**
 * PDF 의 글자를 쪽 순서대로 잇습니다.
 *
 * **워커 주소를 우리가 직접 줍니다**(`?url`). pdf.js 는 기본으로 자기 파일 옆에서 워커를
 * 찾는데, 번들된 앱에서는 그 자리가 없어 통째로 실패합니다. Vite 가 `?url` 로 워커를
 * 따로 뽑아 주소를 주므로, 그것을 그대로 넘기면 개발·빌드·데스크톱에서 모두 같은 길로
 * 찾습니다. 워커에서 돌리는 까닭은 **화면이 안 굳게** 하려는 것입니다 — 200쪽짜리 대본을
 * 본 스레드에서 훑으면 몇 초 동안 창이 통째로 멈춥니다.
 *
 * 글자 사이 간격은 pdf.js 가 `hasEOL` 로만 알려 줍니다. 항목마다 붙여 이으면 낱말이
 * 다 붙어 버리므로, 줄 끝이 아니면 사이에 공백을 한 칸 둡니다.
 */
async function fromPdf(file: File): Promise<DocumentText> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    /*
      **한글 PDF 에 반드시 필요합니다.** 한글 PDF 는 대개 `UniKS-UCS2-H` 같은 «미리 정해진
      CMap» 으로 글자를 가리키는데, 그 표가 없으면 pdf.js 가 글리프 번호를 글자로 못 바꿔
      **빈 글이나 깨진 글자**가 나옵니다. 표는 앱과 함께 `/pdfjs/` 에 둡니다
      (까닭과 나르는 길은 `vite.config.ts` 의 `pdfjsAssets`).
    */
    cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
  });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let index = 1; index <= doc.numPages; index += 1) {
    const page = await doc.getPage(index);
    const content = await page.getTextContent();
    let line = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      line += item.hasEOL ? "\n" : " ";
    }
    pages.push(line);
    page.cleanup();
  }
  // 읽고 나면 워커와 버퍼를 놓아 줍니다 — 안 놓으면 큰 PDF 한 편이 메모리에 그대로 남습니다.
  await task.destroy();
  /*
    쪽 사이는 **빈 줄 하나**로만 가릅니다. 쪽번호나 「— 1 —」 같은 머리말은 여기서
    지우지 않습니다 — 무엇이 머리말인지 문서마다 다르고, 잘못 지우면 대사가 사라집니다.
    사람이 칸에서 보고 지우는 편이 안전합니다.
  */
  return { text: tidy(pages.join("\n\n")), pages: doc.numPages };
}

/** 워드(.docx) 는 `mammoth` 가 서식을 버리고 글만 돌려줍니다. */
async function fromDocx(file: File): Promise<DocumentText> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });
  return { text: tidy(result.value) };
}

/**
 * 파일 하나에서 글을 뽑습니다. 읽을 수 없는 갈래면 **왜 못 읽는지** 를 담아 던집니다.
 *
 * 옛 워드(.doc)와 한글(.hwp)은 안 됩니다 — 둘 다 공개된 규격이 아니라 브라우저에서
 * 열 방법이 마땅치 않습니다. 그 둘은 「PDF 로 저장」 한 뒤 넣는 것이 가장 빠릅니다.
 */
export async function readDocumentText(file: File): Promise<DocumentText> {
  const ext = extensionOf(file.name);
  if (ext === ".pdf") return fromPdf(file);
  if (ext === ".docx") return fromDocx(file);
  if (ext === ".rtf") return { text: fromRtf(await file.text()) };
  if ((DOCUMENT_EXTENSIONS as readonly string[]).includes(ext))
    return { text: tidy(await file.text()) };

  if (ext === ".doc" || ext === ".hwp" || ext === ".hwpx")
    throw new Error(
      `${ext} 는 아직 못 읽습니다. 그 프로그램에서 «PDF 로 저장» 하거나 워드(.docx)로 저장해서 넣어 주세요.`,
    );
  /*
    확장자가 없거나 낯설어도 **글 파일일 수 있습니다**(대본을 `.fountain`·`.fdx` 로 두는
    사람이 많습니다). 읽어 보고 깨진 글자가 많으면 그때 거절합니다 — 확장자만 보고
    막으면 멀쩡한 글을 못 넣습니다.
  */
  const text = tidy(await file.text());
  // U+FFFD 는 «못 읽은 글자» 입니다. 많이 섞였으면 글 파일이 아닙니다.
  const broken = (text.match(/�/g) || []).length;
  if (!text || broken > Math.max(8, text.length * 0.01))
    throw new Error(`${file.name} 에서 글을 찾지 못했습니다. PDF·워드(.docx)·텍스트로 넣어 주세요.`);
  return { text };
}

/** 「30,412자 · 24쪽」 처럼 사람이 읽을 한 줄. */
export function describeDocument(name: string, doc: DocumentText): string {
  const chars = `${doc.text.length.toLocaleString("ko-KR")}자`;
  return doc.pages ? `${name} — ${chars} · ${doc.pages}쪽` : `${name} — ${chars}`;
}
