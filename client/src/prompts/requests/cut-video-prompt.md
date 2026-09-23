---
id: cut-video-prompt
label: 컷 영상 프롬프트
---

<!--
  2026-09-22. 

  여태 컷 영상 프롬프트는 **규칙 조립뿐**이었습니다(`lib/cutVideoPrompt.ts` — 컷 카드의 「영상
  프롬프트」 단추, 일괄 생성 3단계). 규칙은 «누가 어디에 서고 카메라가 어떻게 움직이는가» 는
  알지만 상황·환경·동작의 결·표정은 지어낼 수 없습니다. 이 문구가 그 빈자리를 채우는 LLM
  요청입니다 — 컷 카드의 「프롬프트 작성」(영상 칸)과 「AI 일괄 생성」 4단계가 같은 재료로
  같은 요청을 보냅니다(`lib/promptPayloads.ts` 의 `cutVideoRequestPayload`).

  ── 앱이 보내는 데이터(JSON) ────────────────────────────────────────────
  project      작품 설정 — { genres, styles, period, periodUnspecified }. 없으면 null.
  scene        이 장면의 설명(씬 디스크립션). 배경과 상황의 바탕.
  cut          { 제목, 설명 } — 이 컷에서 실제로 일어나는 일.
  acting       대사·연기 지시(한국어). 없으면 null.
  actingEn     같은 것의 영어 — 「프롬프트 말로」 로 받아 둔 것. 없으면 null.
  vfx / vfxEn  효과 서술(한국어 / 영어). 없으면 null.
  seconds      러닝타임(초). 구도잡기 타임라인이 정한 값 — 바꾸지 마세요.
  aspect       화면비("16:9"·"9:16" …). 없으면 null.
  modelId      보낼 영상 모델의 규칙 id(`modelRules.ts`). 없으면 null — 어느 모델에나 통하는 모양으로.
  hasRefVideo  "yes" | "no" — 구도잡기 레퍼런스 영상을 함께 올리는가. yes 면 카메라 무빙은 영상이 말하니
               글은 «그 움직임을 따르되 사람과 재질은 이렇게» 쪽으로 비켜섭니다.
  hasRepresentativeImage "yes" | "no" — 실제 파일이 있는 컷 대표 그림을 외형 참조로 함께 보내는가.
               yes 면 대표 그림에 보이는 인물을 유지하고 개별 시트는 실제 첨부된 것만 추가로 씁니다.
               시트 배열이 빈 인물에게 없는 시트를 보라고 요구하지 마세요.
  style        사용자가 고른 연출 토글의 **한국어 라벨** 목록.
  lookEn       연출·질감 토글의 영어 한 줄(뼈대에 이미 실려 있음). 없으면 null.
  composition  저장한 구도. null 이면 구도를 쓰지 않는 컷 — 구도 이야기를 하지 마세요.
               { 요약, 카메라(사실 — 바꾸지 마세요), 인물자리[], 무빙 {ko,en} | null,
                 타임라인초, 음악, 소품[{색, 이름}] }
  people[]     이 컷에 서는 사람들 — { 이름, 별칭[], 시트[@파일이름…], 생김새, 성별, 키cm, 성격, 연기기준 }.
               시트가 있으면 «지금 상태» 만, 없으면 생김새를 읽어 그 사람을 세웁니다
               (`cut-prompt.md` 의 people 규칙과 같음).
  background   { 이름, 생김새, 장소 } | null.
  draftKo / draftEn
               규칙이 지은 **뼈대**(`buildCutVideoPrompt`). 뼈대에는 @태그가 **없습니다** — 「참고 그림:」·
               「아직 그림 없음:」 꼬리 줄은 앱이 답을 받은 **뒤에** 붙입니다(`promptLinks.relinkPromptText`).
               아래 줄들은 **뼈대에 있을 때만 고정**입니다 — 글자 그대로 제자리에 남기고 그 사이를 채웁니다.
               예시에만 있는 줄을 추가하지 마세요. hasRefVideo=yes이면 정적인 화면 좌표 고정이나 원테이크 강제를
               추가하지 않고, 참조 영상의 카메라 이동·프레이밍·컷 전환·타이밍을 따릅니다.
               영문 뼈대의 고정 줄은 이렇게 시작합니다(한글 뼈대에는 같은 뜻의 한국어 줄이 같은 자리에).
                 · "People: …" — 인물 시트 또는 대표 그림을 사용하는 실제 뼈대의 문구
                 · "Screen placement (left 0% to right 100%, top 0% to bottom 100%) — …"   (화면에서의 자리(…) — …)
                 · "How 이름 performs — …"  ·  "N extras — anonymous passers-by …"          (… 의 연기 기준 — … · 엑스트라 N명 — …)
                 · "Follow the camera motion and timing of the attached reference video …"  (hasRefVideo=yes 일 때만)
                 · "Camera: …"                                                               (무빙이 있고 레퍼런스 영상이 없을 때)
                 · "The location is exactly the attached background "…". …"                (장소는 첨부한 «…» 배경 그대로입니다 …)
                 · "Background: seamless cyclorama studio, solid … background, …"            (호리존 방일 때 — 배경: 호리존 스튜디오 …
                   호리존이 장소를 이기므로 이때는 위 장소 줄이 없습니다 — `horizonOverridesLocation`)
                 · "Replace … with … Keep its position and size (…) exactly as in the layout." (소품 바꿔 그리기 — … → … 자리와 크기(…)는 그대로)
                 · "Acting: …" + "Perform the mouth movements …"  또는  "Dialogue and acting: …"(그 모델의 대사 문법 —
                   콜론·대괄호·<d>·{}·Dialogue: 블록)                                       (연기: … / 대사·연기: …)
                 · "Effects: …"                                                              (효과: …)
                 · lookEn 한 줄(쉼표 구절 — 영문 뼈대에만 있음)
                 · "One continuous shot. No cut to another scene, …"  또는 Runway 꼴
                   "One continuous shot, a single unbroken scene from start to finish, …"    (한 번에 이어지는 한 컷입니다 …)
                 · "Format: exactly N.N seconds, … aspect ratio. Run to the last frame."     (형식: N.N초 · 화면비 … 마지막 프레임까지 …)
                 · "Keep …'s face, hair and outfit, and the location and lighting, identical to the attached references
                   throughout the entire shot."                                              (… 의 얼굴·머리·의상, 그리고 장소와 빛을 …)
               맨 첫 줄 「제목 — 설명」 은 고정이 아니라 **씨앗**입니다(영문 뼈대에도 한국어로 들어 있음) — 상황 문단으로
               고쳐 씁니다. 한글 뼈대에서 대사 줄 뒤에 괄호로 붙은 안내와 「…화자 N명까지…」 경고는 사람에게 남긴
               메모라 옮기지 않습니다.

  출력은 `{"ko", "en", "negativeKo", "negativeEn"}` — 다른 요청과 같은 네 칸이지만, 영상은 **ko·en 만 저장합니다**
  (`bootstrapPrompts.writeOne` · 컷 카드 영상 칸). negative 두 칸은 빈 문자열이고 금지는 본문에 모델 규칙대로 들어갑니다.
-->

이 컷을 **영상으로** 뽑을 프롬프트를 씁니다. 앱이 규칙으로 지은 뼈대(`draftKo`/`draftEn`)를
받아, **고정된 줄은 글자 그대로 제자리에 두고** 그 사이에 상황·환경·인물의 동작과 표정·카메라·
빛·공기를 채웁니다.

뼈대는 다시 쓸 **골격**이지 되풀이할 글이 아닙니다. 첫 줄 「제목 — 설명」 은 씨앗이라 상황 문단으로
고쳐 쓰고(영문 칸에서는 영어로), 시트가 없는 사람의 생김새는 뼈대에 없어도 여기서 채웁니다.
뼈대에는 @태그가 없습니다 — 「참고 그림:」·「아직 그림 없음:」 줄은 앱이 답을 받은 **뒤에** 붙이니
그 줄을 짓거나 옮겨 적지 마세요. 사람은 뼈대의 「People:」 줄에 적힌 **이름 그대로** 부릅니다.

## 절대 바꾸지 않는 것

**숫자·레퍼런스 문구·대사 문법을 실은 줄은 전부 고정입니다.** 글자 하나 고치지 않고, 순서와 자리도
그대로 둡니다. 당신은 그 **사이**에 씁니다.

- 「People: … — draw them exactly as in the attached character sheets.」 와 「Screen placement (…) — …
  Keep these positions.」, 「How … performs — …」, 「N extras — …」 (한글은 「사람: …」 「화면에서의 자리(…) — …」
  「… 의 연기 기준 — …」 「엑스트라 N명 — …」).
- 「Follow the camera motion and timing of the attached reference video …」 (hasRefVideo=yes 일 때) 또는
  「Camera: …」 (한글 「카메라: …」).
- 「The location is exactly the attached background "…". …」, 호리존 방의 「Background: seamless cyclorama
  studio, …」, 소품의 「Replace … Keep its position and size (…) exactly as in the layout.」.
- 「Acting: …」 과 그 뒤의 「Perform the mouth movements …」, 또는 「Dialogue and acting: …」 과 그 대사 줄들 —
  콜론·대괄호·`<d>`·`{}`·「Dialogue:」 블록은 **그 모델의 문법**입니다. 따옴표 하나도 바꾸지 마세요.
  (한글 「연기: …」 「대사·연기: …」 도 같습니다. 다만 한글 뼈대에서 대사 줄 뒤에 괄호로 붙은 안내와
  「…화자 N명까지…」 경고는 사람에게 남긴 메모입니다 — 프롬프트에 옮기지 마세요.)
- 「Effects: …」 (「효과: …」) 와 영문 뼈대의 `lookEn` 구절 한 줄.
- 「One continuous shot. …」 (또는 Runway 꼴 「One continuous shot, a single unbroken scene …」),
  「Format: exactly N.N seconds, … aspect ratio. Run to the last frame.」, 맨 뒤의 「Keep …'s face, hair and
  outfit, and the location and lighting, identical to the attached references throughout the entire shot.」
  — 한글의 「한 번에 이어지는 한 컷입니다 …」 「형식: …」 「… 얼굴·머리·의상, 그리고 장소와 빛을 …」 도 같습니다.
  단, 연속 원테이크 줄은 hasRefVideo=no이고 뼈대에 있을 때만 유지합니다. hasRefVideo=yes이면
  「Follow the reference video's camera movement, framing, shot changes and their timing. …」와 같은 뜻의
  한국어 줄을 유지합니다. 「Screen placement … Keep these positions.」를 새로 추가하지 마세요.
- `composition.카메라`·`무빙`·`인물자리`·`seconds`·`aspect` — 사용자가 3D 화면에서 잰 값입니다. 새 카메라
  동작을 발명하지 마세요.

## 사실은 지키고, **사실이 말하지 않는 곳은 채웁니다**

뼈대는 «누가 어디에 서고 카메라가 어떻게 움직이는가» 까지만 압니다. 그 안에서 **무슨 일이 어떻게
일어나는가** — 손이 언제 멈추고 시선이 몇 초에 떨어지는지, 벽이 무슨 재질이고 빛이 어디서 오는지 —
는 아무도 정해 주지 않았습니다. 그것을 채우는 것이 이 일입니다. 사람은 62개 컷마다 그것을 하나하나
생각해 낼 수 없어서 당신을 부른 것입니다. 받은 말을 어순만 바꿔 잇지 마세요.

**지어내도 되는 것과 안 되는 것.** 사실을 **거스르는** 것만 금지입니다. 카메라·인물 자리·길이·
화면비·누가 있는가·무슨 일이 일어나는가는 못 박힌 값입니다. 그 위에 얹는 재질·빛·공기·버릇·동작의
결은 얼마든지 지어내세요. 다만 장소·시간대·날씨·계절은 `scene`·`background` 에서만 가져옵니다 —
거기 없으면 그 항목은 비워 둡니다. 그것은 「채우는 것」 이 아니라 「바꾸는 것」 입니다.

## 본문이 반드시 지나가는 여섯 자리 — 이 순서로

고정 줄은 제자리에 두고, 산문은 그 사이 빈자리에 이 순서로 놓습니다. 어느 줄 뒤에 두는지는 괄호에.

1. **상황** — 무슨 일이 **왜** 일어나는 순간인가. 바로 앞에 무엇이 있었고 이 컷 안에서 무엇으로
   이어지는지. 이야기를 설명하지 말고 **화면에 찍히는 것**으로 — 「방금 문을 닫은 손이 아직 손잡이에
   남아 있다」 처럼. `cut`·`scene`·`acting` 에서 나옵니다. (첫 줄 「제목 — 설명」 을 이것으로 고쳐 씁니다.)
2. **환경** — 장소·시간대·날씨·계절은 `scene`·`background` 에 있는 것만. 벽·바닥·천장(또는 땅·하늘)의
   재질과 상태, 소품의 상태(새것·닳음·젖음·먼지), **프레임 밖의 흔적**(화면 밖에서 들어온 그림자, 잘린
   사물의 가장자리, 보이지 않는 창이 만든 빛)은 재료가 침묵해도 당신이 채웁니다. `background.시트` 가
   있으면 장소는 그림이 말하니 구조를 다시 적지 말고 **이 컷의 지금 상태**만 — 시트가 없으면
   `생김새`(안에 «시간대: …»·«분위기: …» 줄이 있으면 그것도)·`장소` 를 읽어 장소를 세웁니다.
   (「Camera:」 또는 레퍼런스 영상 줄 뒤, 「People:」 줄 앞. 둘 다 없으면 상황 바로 뒤.)
3. **인물의 상태와 동작 비트** — 사람마다 컷이 시작될 때의 자세와 무게중심·손·시선·표정·옷의 상태를
   적고, 그다음 **동작 비트 3~5개**를 대략의 시각과 함께 적습니다 — 「0~1.5초: …, 1.5~3초: …, 3~4초: …」.
   비트의 합이 `seconds` 와 같아야 합니다. 비트마다 **표정과 시선의 변화**가 하나씩 — 「입꼬리가 먼저
   풀리고 시선이 반 박자 늦게 내려간다」 처럼 근육과 방향으로, 감정 이름으로 적지 않습니다.
   `연기기준`·`성격` 이 그 사람의 버릇입니다. 시트가 있는 사람은 얼굴 구조·체형을 적지 않고(그림이
   말합니다) «지금 상태» 만, 시트가 빈 사람은 `생김새`·`성별`·`키cm` 를 읽어 얼굴 구조·머리·체형·옷 층을
   영문 40 낱말 안팎으로 세웁니다. 사람이 여럿이면 한 사람도 빠뜨리지 마세요.
   (「People:」·「Screen placement」·「How … performs」·「… extras」 줄 뒤.)
4. **카메라** — `composition.무빙` 이 있고 hasRefVideo=no 면 그 무빙을 **말로 다시** 한두 문장: 무엇을
   따라가는지, 어디서 시작해 어디서 멈추는지, 속도(`slow`·`gradual`, 몇 초에 걸쳐). 「Camera:」 줄이
   이미 말한 것을 되풀이하지 말고 그 움직임이 **화면에 무엇을 드러내는지**를 적습니다. **새 무빙 금지.**
   hasRefVideo=yes 면 카메라 말을 한마디도 하지 않습니다 — 「따르라」 줄이 전부입니다.
   `composition` 이 `null` 이면 카메라를 언급하지 않습니다. (「Camera:」 줄 바로 뒤.)
5. **빛·공기** — 광원(**무엇이, 어디에**), 방향, 색온도, 그림자의 경도, 반사(젖은 바닥·유리·눈의
   캐치라이트), 그리고 컷 안에서 빛이 **어떻게 변하는지**(구름이 지나며, 등이 켜지며, 헤드라이트가
   훑으며). 공기 — 먼지·입김·습기·열기의 일렁임·빗줄기·연기가 **어떻게 움직이는지**. `vfx` 는 여기에
   녹입니다 — 「Effects:」 줄은 이름을 대고, 여기는 그것이 화면에서 어떻게 보이고 움직이는지를 적습니다.
   실사면 피부(「늘 지킬 것」 절의 문장) — 영상은 프레임마다 다시 그려 그림보다 더 자주 플라스틱이
   됩니다. (장소·호리존·소품 줄 뒤, 「Dialogue and acting:」/「Acting:」 줄 앞.)
6. **연출·질감** — `style` 라벨과 `lookEn` 구절이 이미 말한 것(그레인·심도·조명 종류)은 **한 번만**.
   영문 뼈대의 `lookEn` 줄은 그대로 두고 본문에서 같은 말을 되풀이하지 않습니다. 한글에는 `style` 의
   라벨을 같은 자리에 한국어로. 품질 수식어는 쓰지 않습니다.

**소리는 적지 않습니다.** 대사·발성·효과음·음악은 모델마다 규칙이 따로 있고, 대사는 이미 고정 줄이
그 모델의 문법으로 실었습니다. 「빗소리가 들린다」 대신 「빗줄기가 유리를 타고 내린다」 로 — 보이는 것만.

## 길이

**영문 칸에서 고정 줄을 뺀 산문이 150~260 낱말.** 150 아래면 위 여섯 자리 중 어딘가가 비어 있는
것이고, 260 을 넘으면 생성기가 뒤를 흘려 맨 뒤의 형식·잠금 줄이 약해집니다.

**한 구절마다 화면에 새로 보이거나 새로 움직이는 것이 하나** 있어야 합니다. 늘리려고 이런 것을 넣지 마세요.

- 같은 뜻의 반복 — `slowly, gradually, gently` 처럼 한 뜻을 세 낱말로.
- 감정 이름의 나열 — 「슬프게, 쓸쓸하게」. 근육과 시선의 변화 하나면 됩니다.
- 시트가 이미 말하는 생김새 — 그림과 싸워 얼굴이 흔들립니다.
- 고정 줄이 이미 말한 것 — 화면 자리·카메라·형식·잠금을 산문으로 한 번 더.
- 잴 수 없는 말 — 「분위기 있는」 「영화 같은」 — 과 품질 수식어(「늘 지킬 것」 절의 목록).

한글(`ko`)은 같은 내용입니다. 낱말 수로 재지 말고 **영문 문장마다 한글 문장이 짝이 되는지**로 잽니다.
한쪽에만 있는 문장이 생기면 안 됩니다.

## 쓰는 법

- **ko 도 실제 프롬프트입니다** — 사용자는 한국어 프롬프트로도 뽑습니다. en 과 같은 내용을 같은
  자리에, 한글 뼈대의 고정 줄은 한글 그대로. en 에 한국어를 섞지 마세요 — 인물 이름과 고정 줄의
  대사 원문은 예외입니다(「늘 지킬 것」 절).
- 명령형 동사를 본문에 쓰지 마세요 — 「바꿔」 가 아니라 「입고 있다」. 일부 영상 모델은 그 어투를
  보고 «편집·연장» 작업으로 오인합니다. 고정 줄의 명령형은 앱이 그 모델에 맞춰 둔 것이니 그대로.
- 화면에 글자가 그려지지 않게 하세요 — 자막·이름표·워터마크 없음. 고정 금지 줄이 이미 말합니다.
- **금지는 본문에, 그 모델의 자리 규칙대로.** 영상 프롬프트는 negative 칸을 저장하지 않으므로
  `negativeKo`·`negativeEn` 은 **빈 문자열**로 둡니다. 빼고 싶은 것이 더 있으면 본문에 — 부정문이
  통하는 모델이면 고정 금지 줄 옆에 명사로, 부정문이 안 통하는 모델(Runway 등)이면 「그게 없으면
  대신 무엇이 보이나」 를 긍정으로. 대개는 고정 금지 줄이 이미 다 말하니 새로 더하지 않습니다.
- **빛을 반드시 적습니다.** 카메라와 자리는 정해져 있는데 빛이 비면 모델이 고른 대로 나옵니다.

## 출력 형식

```json
{
  "ko": "한글 프롬프트 — 고정 줄은 한글 뼈대 그대로, 그 사이가 채워진 것",
  "en": "English prompt for the video model — fixed lines verbatim, prose in between",
  "negativeKo": "",
  "negativeEn": ""
}
```
