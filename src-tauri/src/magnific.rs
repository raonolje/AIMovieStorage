//! **마그니픽 다리** — 클립보드로 보내기, 그리고 «구성»(그림 → 생성기 자동).
//!
//! 2026-09-18 에 `lib.rs` 에서 떼어 냈습니다. 창 제어(`magnific_window`) · CDP 로 페이지에
//! 직접 명령 보내기(`magnific_cdp`) · 보드 클립보드 형식(`pikaso`) 세 덩이가 여기 모여
//! 있는데, 셋 다 **바깥 프로그램의 속사정**이라 우리 앱의 파일 살림과 섞여 있으면
//! 「이건 우리 규칙인가 마그니픽 규칙인가」 를 매번 되짚어야 했습니다.
//!
//! 「구성」은 마그니픽 데스크톱을 **우리 앱이 켰을 때만** 됩니다 — 디버그 포트 9556 으로
//! CDP 에 붙기 때문입니다. 사용자가 직접 켠 창에는 못 붙습니다.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::{ensure_inside, err, extension_allowed, file_fingerprint, LockSafe, Res};

#[cfg(target_os = "windows")]
/// 클립보드 잠금. OS 클립보드는 하나뿐인데 «구성» 을 여러 개 동시에 돌리면 스레드마다
/// 열고·비우고·쓰기가 겹칩니다. 한쪽이 EmptyClipboard 로 비운 메모리를 다른 쪽이 계속 쓰면
/// 힙 손상(STATUS_HEAP_CORRUPTION)입니다 — 실제로 그렇게 죽었습니다(2026-09-08, 구성 여러 개).
/// 여기 안에서는 await 하지 않습니다(짧게 잡고 놓음).
pub static CLIPBOARD_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn clipboard_guard() -> std::sync::MutexGuard<'static, ()> {
    CLIPBOARD_LOCK.lock_safe()
}

/// «구성» 은 한 번에 하나만. 같은 캔버스에 붙여넣기·선택·Delete 를 동시에 보내면 서로 섞입니다.
/// 뒤의 요청은 앞이 끝날 때까지 기다렸다가 이어서 돕니다.
pub static COMPOSE_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();

pub fn compose_lock() -> &'static tokio::sync::Mutex<()> {
    COMPOSE_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// 다른 «구성» 이 돌고 있는가. 화면이 «앞 구성이 끝나면 이어서» 라고 알리는 데 씁니다.
#[tauri::command]
pub fn magnific_compose_busy() -> bool {
    compose_lock().try_lock().is_err()
}

/// «마그니픽» 보내기도 한 번에 하나.
///
/// 켜기 확인(`launch_magnific_desktop_verified`)이 최대 20초라, 그 사이 다시 누르면 `find_target` 이
/// 아직 None 이라 **두 번째 인스턴스를 또 spawn** 합니다 — 단일 인스턴스 넘겨주기로 곧 꺼지고
/// 「곧 꺼졌습니다 … 완전히 끝내고」 와 「켰습니다」 가 잇달아 떠 멀쩡히 켜지는 마그니픽을 끄게
/// 했습니다(2026-09-22 검토). 뒤 누름은 앞 켜기가 끝나길 여기서 기다렸다가 그 창을 찾아 붙여넣습니다.
/// «구성» 의 `COMPOSE_LOCK` 과 따로 두는 까닭: 구성은 몇 분씩 걸리는데 보내기가 그것을 기다릴 일은 없습니다.
pub static SEND_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();

pub fn send_lock() -> &'static tokio::sync::Mutex<()> {
    SEND_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

pub mod magnific_window {
    use windows::core::{BOOL, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows::Win32::System::Threading::{
        AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEINPUT, VK_CONTROL, VK_V,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowRect,
        GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetCursorPos,
        SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
    };
    use windows::Win32::Foundation::RECT;

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let out = &mut *(lparam.0 as *mut Vec<HWND>);
        out.push(hwnd);
        BOOL(1)
    }

    fn read_text(f: impl FnOnce(&mut [u16]) -> i32) -> String {
        let mut buf = [0u16; 512];
        let n = f(&mut buf).max(0) as usize;
        String::from_utf16_lossy(&buf[..n.min(buf.len())])
    }

    /// 창을 띄운 실행 파일 이름(소문자). 제목만 믿으면 엉뚱한 창을 잡습니다.
    fn owner_exe(hwnd: HWND) -> String {
        let mut pid = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 {
                return String::new();
            }
            let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
                return String::new();
            };
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
                .is_ok();
            let _ = CloseHandle(handle);
            if !ok {
                return String::new();
            }
            let path = String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())]).to_ascii_lowercase();
            path.rsplit(['\\', '/']).next().unwrap_or("").to_string()
        }
    }

    /// 어디에 붙여넣을지.
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Target {
        /// 마그니픽 데스크톱 앱
        Desktop,
        /// 크롬·엣지에서 연 마그니픽 탭
        Browser,
    }

    pub fn target_label(target: Target) -> &'static str {
        match target {
            Target::Desktop => "마그니픽 데스크톱",
            Target::Browser => "브라우저의 마그니픽 탭",
        }
    }

    /// 붙여넣을 창을 고릅니다.
    ///
    /// 사용자가 데스크톱 앱이 불안정할 때 크롬으로 마그니픽을 씁니다. EnumWindows 는 창을
    /// «위에서 아래로»(Z 순서) 주므로, 보이는 후보 중 **가장 위에 있는 것** — 곧 가장 최근에
    /// 쓴 창 — 을 고릅니다. 데스크톱 앱과 크롬 탭이 둘 다 떠 있으면 마지막으로 만진 쪽입니다.
    /// 보이는 것이 없으면 트레이에 숨은 데스크톱 앱. 브라우저 창 제목은 «앞 탭» 의 제목이라,
    /// 마그니픽 탭이 뒤에 있으면 못 찾습니다 — 그때는 탭을 앞에 두라고 알립니다.
    pub fn find_target() -> Option<(HWND, Target)> {
        let mut all: Vec<HWND> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(collect), LPARAM(&mut all as *mut Vec<HWND> as isize));
        }
        let mut desktop_hidden: Option<HWND> = None;
        for hwnd in all {
            let class = read_text(|buf| unsafe { GetClassNameW(hwnd, buf) });
            let title = read_text(|buf| unsafe { GetWindowTextW(hwnd, buf) });
            let visible = unsafe { IsWindowVisible(hwnd).as_bool() && !IsIconic(hwnd).as_bool() };
            if class == "Tauri Window"
                && title.starts_with("Magnific")
                && !title.contains("Preferences")
                && owner_exe(hwnd) == "magnific-desktop.exe"
            {
                if visible {
                    return Some((hwnd, Target::Desktop));
                }
                desktop_hidden.get_or_insert(hwnd);
                continue;
            }
            if class == "Chrome_WidgetWin_1" && visible && title.to_lowercase().contains("magnific") {
                let exe = owner_exe(hwnd);
                if exe == "chrome.exe" || exe == "msedge.exe" {
                    return Some((hwnd, Target::Browser));
                }
            }
        }
        desktop_hidden.map(|hwnd| (hwnd, Target::Desktop))
    }

    /// **마그니픽 데스크톱 앱** 창만 찾습니다(보이든 트레이에 숨었든). 브라우저 탭은 치지 않습니다.
    ///
    /// 자동 구성(CDP)은 우리가 디버그 포트를 켜서 띄운 데스크톱 앱에만 붙습니다. 예전에는 «이미 켜져 있나» 를
    /// `find_target` 으로 봐서, 크롬에 마그니픽 탭(«… | Magnific AI - Chrome»)만 열려 있어도 «우리 앱 밖에서 켜져
    /// 있다» 로 멈췄습니다 — 데스크톱을 완전히 끄고 눌러도 같은 말만 떴습니다. 브라우저 탭은
    /// 데스크톱을 켜는 데 아무 방해가 안 됩니다.
    pub fn find_desktop() -> Option<HWND> {
        let mut all: Vec<HWND> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(collect), LPARAM(&mut all as *mut Vec<HWND> as isize));
        }
        let mut hidden: Option<HWND> = None;
        for hwnd in all {
            let class = read_text(|buf| unsafe { GetClassNameW(hwnd, buf) });
            let title = read_text(|buf| unsafe { GetWindowTextW(hwnd, buf) });
            if class == "Tauri Window"
                && title.starts_with("Magnific")
                && !title.contains("Preferences")
                && owner_exe(hwnd) == "magnific-desktop.exe"
            {
                if unsafe { IsWindowVisible(hwnd).as_bool() && !IsIconic(hwnd).as_bool() } {
                    return Some(hwnd);
                }
                hidden.get_or_insert(hwnd);
            }
        }
        hidden
    }

    /// 트레이에 숨어 있거나 최소화돼 있어도 앞으로 가져옵니다.
    ///
    /// SetForegroundWindow 는 «지금 앞에 있는 스레드» 만 다른 창을 앞으로 보낼 수
    /// 있어서, 앞 창의 스레드에 잠깐 붙었다가 떼는 방식(AttachThreadInput)을 씁니다.
    pub fn bring_to_front(hwnd: HWND) {
        unsafe {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            if !IsWindowVisible(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_SHOW);
            }
            let front = GetForegroundWindow();
            let front_thread = GetWindowThreadProcessId(front, None);
            let me = GetCurrentThreadId();
            let attached =
                front_thread != 0 && front_thread != me && AttachThreadInput(front_thread, me, true).as_bool();
            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);
            if attached {
                let _ = AttachThreadInput(front_thread, me, false);
            }
        }
    }

    pub fn is_front(hwnd: HWND) -> bool {
        unsafe { GetForegroundWindow() == hwnd }
    }

    /// 파일 목록을 클립보드에 넣습니다 (CF_HDROP — 탐색기에서 파일을 복사한 것과 같음).
    ///
    /// 마그니픽 캔버스의 붙여넣기는 `clipboardData.files` 를 읽습니다. 비트맵으로
    /// 넣으면 6000 시트가 144MB 가 되고 파일 이름도 잃지만, 파일 목록이면 가볍고
    /// 이름(= @태그)이 그대로 노드 이름이 됩니다. (2026-09-07 번들 분석)
    pub fn set_clipboard_files(paths: &[std::path::PathBuf]) -> Result<(), String> {
        let _clipboard = super::clipboard_guard();
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::DataExchange::{
            CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
        };
        use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

        // DROPFILES: pFiles(u32)=20, pt(POINT 8바이트), fNC(BOOL), fWide(BOOL)=1 — 20바이트.
        // 그 뒤에 경로들이 UTF-16 으로 \0 구분, 끝에 \0 하나 더.
        let mut wide: Vec<u16> = Vec::new();
        for path in paths {
            wide.extend(path.to_string_lossy().replace('/', "\\").encode_utf16());
            wide.push(0);
        }
        wide.push(0);
        let header = 20usize;
        let total = header + wide.len() * 2;
        const CF_HDROP: u32 = 15;

        unsafe {
            let hmem = GlobalAlloc(GMEM_MOVEABLE, total).map_err(|e| format!("메모리를 잡지 못했습니다: {e}"))?;
            let ptr = GlobalLock(hmem) as *mut u8;
            if ptr.is_null() {
                return Err("메모리를 잠그지 못했습니다.".into());
            }
            std::ptr::write_bytes(ptr, 0, total);
            (ptr as *mut u32).write_unaligned(header as u32);
            (ptr.add(16) as *mut u32).write_unaligned(1);
            std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, ptr.add(header), wide.len() * 2);
            let _ = GlobalUnlock(hmem);

            // 다른 앱이 잠깐 잡고 있을 수 있어 몇 번 다시 시도합니다.
            let mut opened = false;
            for _ in 0..10 {
                if OpenClipboard(None).is_ok() {
                    opened = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            if !opened {
                return Err("클립보드를 열지 못했습니다.".into());
            }
            let result = EmptyClipboard()
                .and_then(|_| SetClipboardData(CF_HDROP, Some(HANDLE(hmem.0))))
                .map(|_| ());
            let _ = CloseClipboard();
            result.map_err(|e| format!("클립보드에 파일을 넣지 못했습니다: {e}"))
        }
    }

    /// 창 가운데를 한 번 클릭합니다.
    ///
    /// 창을 앞으로 가져와도 키보드 초점은 웹뷰 껍데기(Chrome_WidgetWin_1)에 머물러
    /// 페이지의 캔버스까지 키가 가지 않았습니다(2026-09-07 진단). 사용자가 손으로 할
    /// 때처럼 «캔버스 클릭 → Ctrl+V» 순서로 맞춥니다. 캔버스는 창 가운데를 차지합니다.
    pub fn click_center(hwnd: HWND) {
        let mut rect = RECT::default();
        unsafe {
            if GetWindowRect(hwnd, &mut rect).is_err() {
                return;
            }
            let x = (rect.left + rect.right) / 2;
            let y = rect.top + ((rect.bottom - rect.top) * 55) / 100;
            let _ = SetCursorPos(x, y);
            std::thread::sleep(std::time::Duration::from_millis(60));
            let click = |flags| INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 },
                },
            };
            let inputs = [click(MOUSEEVENTF_LEFTDOWN), click(MOUSEEVENTF_LEFTUP)];
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }

    /// 키 하나(누르고 떼기). with_ctrl 이면 Ctrl 을 잡고 칩니다.
    fn tap(vk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY, with_ctrl: bool) {
        let key = |vk, flags| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 },
            },
        };
        let mut inputs = vec![];
        if with_ctrl {
            inputs.push(key(VK_CONTROL, KEYBD_EVENT_FLAGS(0)));
        }
        inputs.push(key(vk, KEYBD_EVENT_FLAGS(0)));
        inputs.push(key(vk, KEYEVENTF_KEYUP));
        if with_ctrl {
            inputs.push(key(VK_CONTROL, KEYEVENTF_KEYUP));
        }
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }

    /// 글자를 유니코드로 그대로 칩니다.
    ///
    /// 자판 키(VK_T…)로 치면 한글 IME 가 켜져 있을 때 «ㅅ» 같은 한글로 바뀝니다.
    /// KEYEVENTF_UNICODE 는 IME 를 거치지 않고 글자 그대로 들어갑니다.
    fn type_unicode(text: &str) {
        use windows::Win32::UI::Input::KeyboardAndMouse::{KEYEVENTF_UNICODE, VIRTUAL_KEY};
        let mut inputs = vec![];
        for unit in text.encode_utf16() {
            for flags in [KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP] {
                inputs.push(INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT { wVk: VIRTUAL_KEY(0), wScan: unit, dwFlags: flags, time: 0, dwExtraInfo: 0 },
                    },
                });
            }
        }
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }

    /// 마그니픽 스페이스에 **텍스트 노드를 만들고 그 안에 붙여넣기**.
    ///
    /// 캔버스에 바로 붙여넣으면 노드는 생기지만 `@이름` 이 맨글자로 남습니다. 마그니픽은
    /// **텍스트 노드 에디터 안에서 붙여넣을 때만** `@이름` 을 보드 요소와 맞춰 칩으로 잇습니다
    /// (번들 `mentionAutoResolve` 플러그인 — 이름 퍼지 매칭이라 한글 이름도 됩니다).
    ///
    /// 그래서 마그니픽의 «요소 추가» 단축키 **N** 으로 스포트라이트를 열고, «text» 를 검색해
    /// Enter 로 텍스트 노드를 만듭니다(단축키 레지스트리: openSpotlight → KeyN). 새 노드는
    /// 커서가 이미 안에 있어 바로 Ctrl+V 하면 됩니다. 노드 좌표를 추측하지 않아
    /// 창 크기·줌 배율과 무관합니다. 좌표 더블클릭으로 편집을 열던 예전 시도는 다섯 번 실패했습니다.
    /// 스포트라이트 검색어(query)로 노드를 만들고 그 안에 붙여넣습니다. 쓰는 건 "text"(텍스트 노드)뿐.
    /// 검색은 라벨이 아니라 키워드로도 되므로 한국어 UI 에서도 영어 검색어가 맞습니다.
    /// 이미지 생성기는 "image generator"·"picture"·모델 슬러그 세 검색어가 다 안 맞아(2026-09-07)
    /// 스포트라이트로 만들지 않고 magnific_paste_flow(복사 형식 JSON 붙여넣기)로 만듭니다.
    pub fn paste_into_new_node(hwnd: HWND, query: &str) {
        use windows::Win32::UI::Input::KeyboardAndMouse::{VK_ESCAPE, VK_N, VK_RETURN};
        let wait = |ms| std::thread::sleep(std::time::Duration::from_millis(ms));
        // 캔버스를 한 번 눌러 초점을 페이지 안으로. 눌린 자리에 노드가 있으면 선택되니 Esc 로 풉니다.
        click_center(hwnd);
        wait(200);
        tap(VK_ESCAPE, false);
        wait(150);
        tap(VK_N, false);
        wait(600);
        type_unicode(query);
        wait(450);
        tap(VK_RETURN, false);
        wait(1100);
        paste();
        // 편집을 닫아 노드가 «선택된» 상태로 둡니다. 편집 중에 Ctrl+C 를 누르면 글자만 복사되고
        // 노드(id·연결)는 복사되지 않아 생성기를 이을 수 없습니다. Esc 는 한 번만 — 두 번이면
        // 캔버스의 «선택 해제» 로 넘어갑니다.
        // 칩 변환은 붙여넣기 뒤 워커에서 비동기로 돕니다. 0.4초 뒤 Esc 는 너무 일러 맨글자로
        // 남았습니다(2026-09-07, 냥이_001 그림이 있는데도). 넉넉히 기다립니다.
        wait(1800);
        tap(VK_ESCAPE, false);
    }

    /// 클립보드의 «HTML Format» 내용을 읽습니다.
    ///
    /// 마그니픽은 노드를 복사할 때 text/html 의 `data-pikaso="PKS_…"` 속성에
    /// 요소·연결 JSON 을 인코딩해 넣습니다. 그걸 읽어야 보드 구조를 알 수 있습니다.
    pub fn read_clipboard_html() -> Option<String> {
        let _clipboard = super::clipboard_guard();
        use windows::core::PCWSTR;
        use windows::Win32::System::DataExchange::{
            CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW,
        };
        use windows::Win32::Foundation::HGLOBAL;
        use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
        let name: Vec<u16> = "HTML Format".encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let format = RegisterClipboardFormatW(PCWSTR(name.as_ptr()));
            if format == 0 {
                return None;
            }
            let mut opened = false;
            for _ in 0..10 {
                if OpenClipboard(None).is_ok() {
                    opened = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            if !opened {
                return None;
            }
            let result = (|| {
                // 형식이 없을 때 GetClipboardData 를 부르지 않고, 크기를 모르면 읽지 않습니다.
                // 앱이 힙 손상(0xc0000374)으로 죽은 적이 있어(2026-09-08, CDP 구성 중) 안전 검사를 더 겁니다.
                if IsClipboardFormatAvailable(format).is_err() {
                    return None;
                }
                let handle = GetClipboardData(format).ok()?;
                if handle.0.is_null() {
                    return None;
                }
                let hglobal = HGLOBAL(handle.0);
                let size = GlobalSize(hglobal);
                if size == 0 {
                    return None;
                }
                let ptr = GlobalLock(hglobal) as *const u8;
                if ptr.is_null() {
                    return None;
                }
                let bytes = std::slice::from_raw_parts(ptr, size);
                let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
                let text = String::from_utf8_lossy(&bytes[..end]).into_owned();
                let _ = GlobalUnlock(hglobal);
                Some(text)
            })();
            let _ = CloseClipboard();
            result
        }
    }

    /// 바이트를 전역 메모리에 복사해 클립보드 핸들로 돌려줍니다.
    unsafe fn global_handle(bytes: &[u8]) -> Result<windows::Win32::Foundation::HANDLE, String> {
        use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
        let hmem = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|e| format!("메모리를 잡지 못했습니다: {e}"))?;
        let ptr = GlobalLock(hmem) as *mut u8;
        if ptr.is_null() {
            return Err("메모리를 잠그지 못했습니다.".into());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        let _ = GlobalUnlock(hmem);
        Ok(windows::Win32::Foundation::HANDLE(hmem.0))
    }

    /// text/html(CF_HTML)과 글자를 같이 클립보드에 넣습니다.
    ///
    /// 마그니픽은 붙여넣을 때 text/html 의 `data-pikaso` 를 먼저 보고, 없으면 text/plain 이
    /// `PKS_` 로 시작하는지 봅니다. 둘 다 넣어 어느 경로든 우리 요소 JSON 이 잡히게 합니다.
    /// CF_HTML 머리말의 오프셋은 UTF-8 바이트 기준 10자리입니다(크로미움이 그대로 읽음).
    pub fn set_clipboard_html_text(fragment: &str, text: &str) -> Result<(), String> {
        let _clipboard = super::clipboard_guard();
        use windows::core::PCWSTR;
        use windows::Win32::System::DataExchange::{
            CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
        };
        const CF_UNICODETEXT: u32 = 13;
        let head = "<html><body><!--StartFragment-->";
        let tail = "<!--EndFragment--></body></html>";
        let body = format!("{head}{fragment}{tail}");
        let header_len = "Version:0.9\r\nStartHTML:0000000000\r\nEndHTML:0000000000\r\nStartFragment:0000000000\r\nEndFragment:0000000000\r\n".len();
        let start_html = header_len;
        let end_html = header_len + body.len();
        let start_fragment = header_len + head.len();
        let end_fragment = end_html - tail.len();
        let cf_html = format!(
            "Version:0.9\r\nStartHTML:{start_html:010}\r\nEndHTML:{end_html:010}\r\nStartFragment:{start_fragment:010}\r\nEndFragment:{end_fragment:010}\r\n{body}"
        );
        let mut html_bytes = cf_html.into_bytes();
        html_bytes.push(0);
        let mut wide: Vec<u16> = text.encode_utf16().collect();
        wide.push(0);
        let name: Vec<u16> = "HTML Format".encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let format = RegisterClipboardFormatW(PCWSTR(name.as_ptr()));
            if format == 0 {
                return Err("HTML 클립보드 형식을 등록하지 못했습니다.".into());
            }
            let mut opened = false;
            for _ in 0..10 {
                if OpenClipboard(None).is_ok() {
                    opened = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            if !opened {
                return Err("클립보드를 열지 못했습니다.".into());
            }
            // 클립보드를 연 뒤에 잡습니다. 못 넘긴 핸들은 우리가 되돌려 줘야 합니다(넘긴 것은 시스템 소유).
            let free = |handle: windows::Win32::Foundation::HANDLE| {
                let _ = windows::Win32::Foundation::GlobalFree(Some(windows::Win32::Foundation::HGLOBAL(handle.0)));
            };
            let result = (|| -> Result<(), String> {
                EmptyClipboard().map_err(|e| e.to_string())?;
                let h_html = global_handle(&html_bytes)?;
                if let Err(e) = SetClipboardData(format, Some(h_html)) {
                    free(h_html);
                    return Err(e.to_string());
                }
                let wide_bytes = std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2);
                let h_text = global_handle(wide_bytes)?;
                if let Err(e) = SetClipboardData(CF_UNICODETEXT, Some(h_text)) {
                    free(h_text);
                    return Err(e.to_string());
                }
                Ok(())
            })();
            let _ = CloseClipboard();
            result.map_err(|e| format!("클립보드에 넣지 못했습니다: {e}"))
        }
    }

    /// Ctrl+V. 마그니픽 창이 앞에 있을 때만 부릅니다.
    pub fn paste() {
        let key = |vk, flags| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 },
            },
        };
        let inputs = [
            key(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
            key(VK_V, KEYBD_EVENT_FLAGS(0)),
            key(VK_V, KEYEVENTF_KEYUP),
            key(VK_CONTROL, KEYEVENTF_KEYUP),
        ];
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }
}

/// 마그니픽 데스크톱 페이지에 CDP(크롬 디버그 프로토콜)로 붙습니다.
///
/// 마그니픽 데스크톱은 Tauri + WebView2 입니다. 우리가 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
/// 에 `--remote-debugging-port=9556` 을 넣어 실행하면 페이지에 직접 명령을 보낼 수 있습니다
/// (우리 앱 자신을 시험할 때 쓰는 방식과 같음). OS 로 보내는 Ctrl+C 는 데스크톱 창에서 페이지까지
/// 가지 않았지만(2026-09-07), CDP 로 페이지 안에 넣는 키는 갑니다(Ctrl+A·Ctrl+C 확인, 2026-09-08).
/// 창이 앞에 있을 필요도 없습니다. 이미 떠 있는 창에는 못 붙으니 마그니픽은 우리 앱에서 켭니다.
pub mod magnific_cdp {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    pub const PORT: u16 = 9556;

    /// 웹소켓 연결 마감. 로컬 루프백이라 보통 즉시지만, 포트만 열리고 핸드셰이크가 안 끝나면 매달립니다.
    pub const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

    /// CDP 호출 하나(보내기 + 우리 id 의 응답 받기)의 마감.
    ///
    /// 2026-09-21 실측: «구성» 을 눌렀는데 17분째 «구성하는 중…» 에 묶여 있었습니다. 마그니픽
    /// 페이지가 멈추면 우리 id 의 응답은 영영 안 오는데, 여기엔 마감이 없어서 그대로 기다렸습니다.
    /// 정상은 밀리초지만 6000×6000 시트를 붙여넣어 렌더러가 디코딩하는 동안은 dispatchKeyEvent
    /// 응답이 몇 초 늦을 수 있어 짧게 잡으면 헛발질합니다 — 30초.
    pub const CALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

    /// 디버그 포트에서 마그니픽 앱 페이지를 찾습니다. (ws 주소, 페이지 url)
    pub async fn find_app_page() -> Result<(String, String), String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .map_err(|e| e.to_string())?;
        let targets: serde_json::Value = client
            .get(format!("http://127.0.0.1:{PORT}/json"))
            .send()
            .await
            .map_err(|_| "NO_PORT".to_string())?
            .json()
            .await
            .map_err(|e| format!("디버그 대상 목록을 읽지 못했습니다: {e}"))?;
        let list = targets.as_array().cloned().unwrap_or_default();
        let page = list
            .iter()
            .find(|t| {
                t.get("type").and_then(|v| v.as_str()) == Some("page")
                    && t.get("url").and_then(|v| v.as_str()).map(|u| u.contains("magnific.com/app")).unwrap_or(false)
            })
            .ok_or("마그니픽 앱 페이지를 찾지 못했습니다. 마그니픽에 로그인해 스페이스를 여세요.")?;
        let url = page.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let ws = page
            .get("webSocketDebuggerUrl")
            .and_then(|v| v.as_str())
            .ok_or("디버그 주소가 없습니다.")?
            .to_string();
        Ok((ws, url))
    }

    pub struct Cdp {
        ws: tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
        seq: u64,
        /// 지금 무슨 단계를 밟는 중인지. 마감이 터졌을 때 «어디서» 멈췄는지 문구에 남기려고 듭니다 —
        /// eval·key·click 이 전부 `call` 하나를 거치므로 문구도 여기 한 벌입니다.
        stage: &'static str,
    }

    impl Cdp {
        pub async fn connect(url: &str) -> Result<Self, String> {
            let (ws, _) = tokio::time::timeout(CONNECT_TIMEOUT, tokio_tungstenite::connect_async(url))
                .await
                .map_err(|_| format!("CDP 연결이 {}초 안에 안 됐습니다. 마그니픽 창이 살아 있는지 확인하세요.", CONNECT_TIMEOUT.as_secs()))?
                .map_err(|e| format!("CDP 연결 실패: {e}"))?;
            Ok(Self { ws, seq: 0, stage: "연결" })
        }

        /// 지금 단계 이름. 마감 오류 문구에 그대로 들어갑니다.
        pub fn set_stage(&mut self, stage: &'static str) {
            self.stage = stage;
        }

        pub async fn call(&mut self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
            self.seq += 1;
            let id = self.seq;
            let msg = serde_json::json!({ "id": id, "method": method, "params": params });
            // 마감은 «받기 한 번마다» 가 아니라 **호출 전체**에 하나. 페이지가 멈춰도 CDP 알림 메시지는
            // 계속 오므로 recv 마다 타이머를 새로 잡으면 영영 안 터집니다(17분 매달림이 그 모양).
            let deadline = tokio::time::Instant::now() + CALL_TIMEOUT;
            let stage = self.stage;
            let stalled = move || {
                format!(
                    "마그니픽 페이지가 {}초 동안 응답하지 않습니다({stage} — {method}). 마그니픽 창이 살아 있는지 확인하고 «구성» 을 다시 누르세요.",
                    CALL_TIMEOUT.as_secs()
                )
            };
            tokio::time::timeout_at(deadline, self.ws.send(Message::Text(msg.to_string())))
                .await
                .map_err(|_| stalled())?
                .map_err(|e| format!("CDP 보내기 실패: {e}"))?;
            loop {
                let next = tokio::time::timeout_at(deadline, self.ws.next())
                    .await
                    .map_err(|_| stalled())?
                    .ok_or("CDP 연결이 끊겼습니다.")?
                    .map_err(|e| format!("CDP 받기 실패: {e}"))?;
                if let Message::Text(text) = next {
                    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
                    if v.get("id").and_then(|i| i.as_u64()) == Some(id) {
                        if let Some(err) = v.get("error") {
                            return Err(format!("CDP 오류: {err}"));
                        }
                        return Ok(v.get("result").cloned().unwrap_or_default());
                    }
                }
            }
        }

        pub async fn eval(&mut self, expression: &str) -> Result<serde_json::Value, String> {
            let r = self
                .call(
                    "Runtime.evaluate",
                    serde_json::json!({ "expression": expression, "awaitPromise": true, "returnByValue": true }),
                )
                .await?;
            if let Some(ex) = r.get("exceptionDetails") {
                let text = ex.pointer("/exception/description").and_then(|t| t.as_str())
                    .or_else(|| ex.get("text").and_then(|t| t.as_str()))
                    .unwrap_or("?");
                return Err(format!("페이지 JS 오류: {text}"));
            }
            Ok(r.pointer("/result/value").cloned().unwrap_or(serde_json::Value::Null))
        }

        /// 키 하나(누르고 떼기). 페이지 안으로 바로 들어가므로 창이 앞에 없어도 됩니다.
        pub async fn key(&mut self, code: &str, vk: u32, ctrl: bool, shift: bool) -> Result<(), String> {
            let modifiers = (if ctrl { 2 } else { 0 }) | (if shift { 8 } else { 0 });
            for kind in ["rawKeyDown", "keyUp"] {
                self.call(
                    "Input.dispatchKeyEvent",
                    serde_json::json!({
                        "type": kind, "modifiers": modifiers, "code": code, "key": code,
                        "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk,
                    }),
                )
                .await?;
            }
            Ok(())
        }

        pub async fn click(&mut self, x: f64, y: f64, shift: bool) -> Result<(), String> {
            let modifiers = if shift { 8 } else { 0 };
            self.call("Input.dispatchMouseEvent", serde_json::json!({ "type": "mouseMoved", "x": x, "y": y, "modifiers": modifiers })).await?;
            self.call("Input.dispatchMouseEvent", serde_json::json!({ "type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1, "modifiers": modifiers })).await?;
            self.call("Input.dispatchMouseEvent", serde_json::json!({ "type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1, "modifiers": modifiers })).await?;
            Ok(())
        }

        /// 캔버스 노드(Vue Flow) id 목록. selected_only 면 선택된 것만.
        pub async fn node_ids(&mut self, selected_only: bool) -> Result<Vec<String>, String> {
            let selector = if selected_only { ".vue-flow__node.selected" } else { ".vue-flow__node" };
            let js = format!("JSON.stringify([...document.querySelectorAll('{selector}')].map(n=>n.dataset.id||''))");
            let v = self.eval(&js).await?;
            Ok(serde_json::from_str::<Vec<String>>(v.as_str().unwrap_or("[]")).unwrap_or_default())
        }

        /// 주어진 노드들의 화면 중심 좌표.
        pub async fn node_centers(&mut self, ids: &[String]) -> Result<Vec<(String, f64, f64)>, String> {
            let want = serde_json::to_string(ids).unwrap_or_else(|_| "[]".into());
            let js = String::from("JSON.stringify((()=>{const want=new Set(") + &want
                + ");return [...document.querySelectorAll('.vue-flow__node')].filter(n=>want.has(n.dataset.id)).map(n=>{const r=n.getBoundingClientRect();return [n.dataset.id,r.x+r.width/2,r.y+r.height/2]})})())";
            let v = self.eval(&js).await?;
            Ok(serde_json::from_str::<Vec<(String, f64, f64)>>(v.as_str().unwrap_or("[]")).unwrap_or_default())
        }
    }
}

/// 마그니픽 보드 클립보드 형식(«PKS_»).
///
/// 노드를 복사하면 `{elements, externalConnections, sourceBoardUuid, timestamp, version}` JSON 을
/// 글자마다 이 키와 XOR 한 뒤 UTF-8 → base64 로 감싸 `PKS_<시각36진수>:<base64>` 로 넣습니다
/// (번들 useBoardDataTransferManager 의 encode/decode 를 그대로 옮김). XOR 은 JS 문자열 단위,
/// 즉 UTF-16 코드 유닛마다 키의 (i mod len) 번째 글자와 합니다.
pub mod pikaso {
    use base64::Engine;
    const KEY: &str = "CNEIWPQLSASNKDFONPQWEFUNASDJFKNCASDKMBOARDS2025";

    fn xor_units(units: &[u16]) -> Vec<u16> {
        let key: Vec<u16> = KEY.encode_utf16().collect();
        units.iter().enumerate().map(|(i, u)| u ^ key[i % key.len()]).collect()
    }

    pub fn decode(encoded: &str) -> Result<serde_json::Value, String> {
        let rest = encoded.strip_prefix("PKS_").ok_or("PKS_ 형식이 아닙니다.")?;
        let (_, b64) = rest.split_once(':').ok_or("PKS_ 형식이 아닙니다(구분자 없음).")?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64.trim())
            .map_err(|e| format!("base64 를 풀지 못했습니다: {e}"))?;
        let text = String::from_utf8(bytes).map_err(|e| format!("UTF-8 이 아닙니다: {e}"))?;
        let units: Vec<u16> = text.encode_utf16().collect();
        let plain = String::from_utf16(&xor_units(&units)).map_err(|e| format!("XOR 결과가 깨졌습니다: {e}"))?;
        serde_json::from_str(&plain).map_err(|e| format!("JSON 이 아닙니다: {e}"))
    }

    pub fn encode(value: &serde_json::Value) -> String {
        let plain = serde_json::to_string(value).unwrap_or_default();
        let units: Vec<u16> = plain.encode_utf16().collect();
        let mixed = String::from_utf16(&xor_units(&units)).unwrap_or_default();
        let b64 = base64::engine::general_purpose::STANDARD.encode(mixed.as_bytes());
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        format!("PKS_{}:{}", radix36(millis), b64)
    }

    fn radix36(mut n: u128) -> String {
        const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
        if n == 0 {
            return "0".into();
        }
        let mut out = Vec::new();
        while n > 0 {
            out.push(DIGITS[(n % 36) as usize]);
            n /= 36;
        }
        out.reverse();
        String::from_utf8(out).unwrap_or_default()
    }

    /// 요소 id 용 UUID v4. uuid 크레이트 없이 OS 난수 시드의 해시로 만듭니다.
    pub fn uuid_v4() -> String {
        use std::hash::{BuildHasher, Hasher};
        let mut words = [0u64; 2];
        for (i, word) in words.iter_mut().enumerate() {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u64(i as u64);
            h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
            *word = h.finish();
        }
        let hi = (words[0] & 0xFFFF_FFFF_FFFF_0FFF) | 0x0000_0000_0000_4000;
        let lo = (words[1] & 0x3FFF_FFFF_FFFF_FFFF) | 0x8000_0000_0000_0000;
        format!(
            "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
            hi >> 32,
            (hi >> 16) & 0xFFFF,
            hi & 0xFFFF,
            lo >> 48,
            lo & 0xFFFF_FFFF_FFFF
        )
    }

    /// 복사한 HTML 에서 `data-pikaso="PKS_…"` 값을 꺼냅니다.
    pub fn extract(html: &str) -> Option<String> {
        let start = html.find("data-pikaso=")? + "data-pikaso=".len();
        let quote = html[start..].chars().next()?;
        let body = &html[start + quote.len_utf8()..];
        let end = body.find(quote)?;
        let value = &body[..end];
        if value.starts_with("PKS_") { Some(value.to_string()) } else { None }
    }
}

/// 마그니픽에서 복사한(Ctrl+C) 그림 요소(creation)에서 뽑은 것.
#[derive(Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CopiedCreation {
    id: String,
    /// 노드 이름 = 올린 파일 이름(확장자 없이). 프롬프트의 `@이름` 과 맞춥니다.
    name: String,
    /// 업로드된 그림의 마그니픽 id. 같은 값으로 그림 노드를 다시 놓으면 재업로드 없이 같은 그림입니다.
    creation_identifier: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    page: String,
    source_board_uuid: Option<String>,
}

pub fn copied_creations(value: &serde_json::Value) -> Vec<CopiedCreation> {
    let board = value.get("sourceBoardUuid").and_then(|v| v.as_str()).map(str::to_string);
    value
        .get("elements")
        .and_then(|e| e.as_array())
        .map(|list| {
            list.iter()
                .filter(|el| el.get("type").and_then(|t| t.as_str()) == Some("creation"))
                .map(|el| {
                    let num = |key: &str| el.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0);
                    CopiedCreation {
                        id: el.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        name: el.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        creation_identifier: el
                            .pointer("/data/creationIdentifier")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        x: num("x"),
                        y: num("y"),
                        width: if num("width") > 0.0 { num("width") } else { 465.0 },
                        height: if num("height") > 0.0 { num("height") } else { 278.0 },
                        page: el.get("page").and_then(|v| v.as_str()).unwrap_or("1").to_string(),
                        source_board_uuid: board.clone(),
                    }
                })
                // 아직 올라가는 중이면 id 가 placeholder 라 다시 놓을 수 없습니다 — 빼고, 없으면 다시 누르게 합니다.
                .filter(|c| !c.id.is_empty() && !c.name.is_empty())
                .filter(|c| !c.creation_identifier.is_empty() && !c.creation_identifier.contains("placeholder") && c.creation_identifier != "empty-creation")
                .collect()
        })
        .unwrap_or_default()
}

/// 프롬프트의 `@이름` 을 마그니픽 칩 표기 `@[요소id:이름:output]` 으로 바꿉니다.
///
/// 이름이 긴 것부터 바꿔 `@냥이_001` 이 `@냥이_001_b` 를 잘라먹지 않게 하고, 태그 뒤가
/// 영문·숫자·밑줄·하이픈이면(이름의 연장) 바꾸지 않습니다.
pub fn with_mention_chips(prompt: &str, creations: &[CopiedCreation]) -> String {
    let mut sorted: Vec<&CopiedCreation> = creations.iter().collect();
    sorted.sort_by_key(|c| std::cmp::Reverse(c.name.chars().count()));
    let mut text = prompt.to_string();
    for creation in sorted {
        // 마그니픽은 붙여넣기 때 같은 이름에 « #2» 를 붙입니다. 프롬프트의 태그는 파일 이름
        // 그대로(`@냥이_001`)이니 꼬리를 떼고 맞추고, 칩 라벨은 실제 노드 이름으로 둡니다.
        let base = match creation.name.rfind(" #") {
            Some(i) if creation.name[i + 2..].chars().all(|c| c.is_ascii_digit()) && i + 2 < creation.name.len() => &creation.name[..i],
            _ => creation.name.as_str(),
        };
        let tag = format!("@{}", base);
        let chip = format!("@[{}:{}:output]", creation.id, creation.name);
        let mut out = String::new();
        let mut rest = text.as_str();
        while let Some(pos) = rest.find(&tag) {
            let after = &rest[pos + tag.len()..];
            // 마그니픽의 멘션 경계 규칙(mentionTokenBoundary: `(?![A-Za-z0-9_-])`)과 같게 — 한글 조사가
            // 바로 붙은 `@냥이_001과` 도 태그로 봅니다. 우리 템플릿이 조사를 붙여 씁니다.
            let extends = after
                .chars()
                .next()
                .map(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
                .unwrap_or(false);
            // 이미 칩 표기(@[…]) 안이면 건너뜁니다.
            let inside_chip = rest[..pos].ends_with('[') || rest[..pos].ends_with(':');
            out.push_str(&rest[..pos]);
            if extends || inside_chip {
                out.push_str(&tag);
            } else {
                out.push_str(&chip);
            }
            rest = after;
        }
        out.push_str(rest);
        text = out;
    }
    text
}

/// 그림 노드 사본 + 이미지 생성기(프롬프트 + @칩) JSON(마그니픽 복사 형식) 을 만듭니다.
///
/// 마그니픽은 «복사» 형식(PKS_ JSON)을 붙여넣으면 요소 id 를 새로 매겨 재생성하고, **같이 붙여넣은
/// 요소끼리의** 연결은 확실히 다시 잇습니다(이미 있던 요소와 잇는 외부 연결은 시험에서 안 됐음).
/// 칩(`@[id:이름:output]`)은 id 로 찾는데, 붙여넣을 때 id 를 고쳐 주는 필드는 «이미지 생성기의 prompt»
/// 등뿐이고 텍스트 노드 본문은 안 고쳐 줍니다(번들 mentionHelpers 의 목록, 2026-09-07 시험에서
/// 텍스트 노드 칩만 취소선). 그래서 프롬프트를 텍스트 노드가 아니라 **생성기의 prompt 칸에** 넣습니다.
/// 그림은 같은 creationIdentifier 로 사본을 넣어(마그니픽의 그림 노드 복사·붙여넣기와 같음, 재업로드
/// 없음) 그림→생성기(reference)를 내부 연결로 만듭니다.
pub fn build_flow_payload(
    prompt: &str,
    creations: &[CopiedCreation],
    model: &str,
    aspect_ratio: &str,
    count: u32,
    // 그림이 없을 때 생성기를 놓을 캔버스 좌표. 없으면 그림 오른쪽.
    origin: Option<(f64, f64)>,
    // "image" 또는 "video". 노드 종류와 data 만 갈립니다.
    kind: Option<&str>,
    // 영상일 때 러닝타임(초). 구도잡기 타임라인이 정한 값이 그대로 옵니다.
    duration_seconds: Option<f64>,
) -> Result<(serde_json::Value, usize), String> {
    if prompt.trim().is_empty() {
        return Err("프롬프트가 비었습니다.".into());
    }
    let count = count.clamp(1, 4);
    let connection = |source: &str, source_port: &str, target: &str, target_port: &str, data_type: &str| {
        serde_json::json!({
            "connectionType": "data-flow",
            "dataType": data_type,
            "id": format!("{source}:{source_port}->{target}:{target_port}"),
            "sourceElementId": source,
            "sourcePort": source_port,
            "targetElementId": target,
            "targetPort": target_port,
        })
    };
    // 자리: 그림 사본은 원본 자리 그대로, 그 오른쪽에 생성기.
    let page = creations.first().map(|c| c.page.clone()).unwrap_or_else(|| "1".into());
    let board = creations.iter().find_map(|c| c.source_board_uuid.clone());
    let right = creations.iter().map(|c| c.x + c.width).fold(f64::MIN, f64::max);
    let top = creations.iter().map(|c| c.y).fold(f64::MAX, f64::min);
    let (gen_x, gen_y) = if creations.is_empty() { origin.unwrap_or((0.0, 0.0)) } else { (right + 140.0, top) };
    let gen_ids: Vec<String> = (0..count).map(|_| pikaso::uuid_v4()).collect();

    // 그림 사본: 새 id, 같은 creationIdentifier. 칩과 연결은 사본 id 로(붙여넣을 때 마그니픽이 새 id 로 고침).
    let copies: Vec<CopiedCreation> = creations
        .iter()
        .map(|c| CopiedCreation { id: pikaso::uuid_v4(), ..c.clone() })
        .collect();
    let mut elements: Vec<serde_json::Value> = Vec::new();
    for copy in &copies {
        let outgoing: Vec<serde_json::Value> =
            gen_ids.iter().map(|g| connection(&copy.id, "output", g, "reference", "image")).collect();
        elements.push(serde_json::json!({
            "id": copy.id,
            "type": "creation",
            "name": copy.name,
            "page": page,
            "x": copy.x,
            "y": copy.y,
            "width": copy.width,
            "height": copy.height,
            "locked": false,
            "visible": true,
            "data": { "creationIdentifier": copy.creation_identifier, "isPlaceholder": false },
            "workflowConnections": { "incoming": [], "outgoing": outgoing },
        }));
    }
    let prompt_with_chips = with_mention_chips(prompt.trim(), &copies);
    for (i, gen_id) in gen_ids.iter().enumerate() {
        let incoming: Vec<serde_json::Value> =
            copies.iter().map(|c| connection(&c.id, "output", gen_id, "reference", "image")).collect();
        /*
            ── 이미지 생성기 / 영상 생성기 ──────────────────────────────
            

            노드 종류와 data 만 갈립니다 — 붙여넣는 방법(그림 먼저, 새 노드 감지, 사본 +
            생성기 JSON)은 완전히 같습니다. 영상에는 `durationSeconds` 가 더 붙습니다.

            **이어 붙이는 선은 영상일 때도 `reference`/`image` 그대로 둡니다.** 레퍼런스
            mp4 의 포트 이름을 확인할 길이 없어서(마그니픽 데스크톱이 있어야 읽힙니다)
            아는 모양을 씁니다. 선이 안 걸리면 노드는 프롬프트·러닝타임까지 갖춘 채로
            놓이니 캔버스에서 손으로 한 번 이어 주면 됩니다 — 틀린 포트 이름을 적어
            노드가 아예 안 생기는 것보다 낫습니다.
        */
        let is_video = kind == Some("video");
        let mut gen_data = serde_json::json!({
            "aspectRatio": aspect_ratio,
            "mode": model,
            "numberOfGenerations": 1,
            "prompt": prompt_with_chips.clone(),
            "version": "v2",
        });
        if is_video {
            if let Some(object) = gen_data.as_object_mut() {
                object.insert(
                    "durationSeconds".into(),
                    serde_json::json!(duration_seconds.unwrap_or(5.0)),
                );
                object.insert("resolution".into(), serde_json::json!("1080p"));
            }
        } else if let Some(object) = gen_data.as_object_mut() {
            object.insert("quality".into(), serde_json::json!(""));
            object.insert("resolution".into(), serde_json::json!("2k"));
            object.insert("smartPrompt".into(), serde_json::json!(true));
            object.insert("thinkingLevel".into(), serde_json::json!(""));
            object.insert("transparentBackground".into(), serde_json::json!(false));
            object.insert("useGoogleSearchTool".into(), serde_json::json!(false));
        }
        elements.push(serde_json::json!({
            "id": gen_id,
            "type": if is_video { "video-generator" } else { "image-generator" },
            "name": if is_video { "영상 생성기" } else { "이미지 생성기" },
            "page": page,
            "x": gen_x,
            "y": gen_y + (i as f64) * (392.0 + 48.0),
            "width": 697,
            "height": 392,
            "locked": false,
            "visible": true,
            "createdBy": "user",
            "data": gen_data,
            "workflowConnections": { "incoming": incoming, "outgoing": [] },
        }));
    }
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let payload = serde_json::json!({
        "elements": elements,
        "externalConnections": {},
        "sourceBoardUuid": board,
        "timestamp": millis,
        "version": "1.0",
    });
    Ok((payload, count as usize))
}

/// 마그니픽 복사 형식 JSON 을 클립보드(text/html + text/plain)에 넣습니다.
pub fn put_flow_on_clipboard(payload: &serde_json::Value) -> Result<(), String> {
    let encoded = pikaso::encode(payload);
    // encoded 는 base64 와 [:_] 뿐이라 따옴표 안에 그대로 둬도 됩니다.
    let html = format!("<div data-pikaso=\"{encoded}\">그림 + 이미지 생성기</div>");
    magnific_window::set_clipboard_html_text(&html, &encoded)
}

/// 마그니픽 데스크톱 실행 파일. 설치 자리는 마그니픽 설치기가 정한 곳입니다.
pub fn magnific_desktop_exe() -> Option<PathBuf> {
    std::env::var("LOCALAPPDATA")
        .map(|dir| Path::new(&dir).join("Magnific").join("magnific-desktop.exe"))
        .ok()
        .filter(|path| path.exists())
}

/// 마그니픽 데스크톱을 **디버그 포트를 켜서** 실행합니다. 자동 구성은 이 포트로만 됩니다.
///
/// spawn 만 하는 원시 함수입니다 — spawn 성공은 CreateProcess 성공일 뿐, 1초 뒤 꺼져도 모릅니다.
/// «실제로 떴는가» 는 [`launch_magnific_desktop_verified`] 가 봅니다. 켜는 명령은 전부 그쪽을
/// 씁니다 — 이 원시 함수를 바로 부르고 「켰다」 고 하면 2026-09-21 처럼 거짓말이 됩니다
/// (`send_prompt_to_magnific` 이 동기 명령이라 그렇게 하다가 async 로 바꿨습니다).
pub fn launch_magnific_desktop() -> Res<std::process::Child> {
    let exe = magnific_desktop_exe().ok_or("마그니픽 데스크톱을 찾지 못했습니다. magnific.com/desktop 에서 설치하세요.")?;
    let mut command = std::process::Command::new(&exe);
    // 탐색기에서 두 번 눌러 켤 때와 같은 cwd(exe 폴더). 우리 앱의 cwd 를 물려주면 조건이 달라집니다.
    if let Some(dir) = exe.parent() {
        command.current_dir(dir);
    }
    command
        .env("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", format!("--remote-debugging-port={}", magnific_cdp::PORT))
        // piped 로 두고 안 읽으면 파이프가 차서 자식이 멈춥니다. 우리는 출력을 안 보니 null.
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| err("마그니픽을 실행하지 못했습니다", e))
}

/// 켜기 확인의 상한. WebView2 가 뜨는 데 몇 초 걸리고, 로그인 화면이라도 포트는 그때 열립니다.
const LAUNCH_WAIT: std::time::Duration = std::time::Duration::from_secs(20);

/// 새 자식이 곧 꺼졌을 때, 넘겨받은 인스턴스가 창을 띄우는 것을 기다려 주는 시간(창만 필요한 길).
const HANDOFF_WAIT: std::time::Duration = std::time::Duration::from_secs(3);

/// 무엇이 떠야 «켜졌다» 인가.
///
/// «구성» 은 CDP 로 붙으니 **포트**가 열려야 하고, «마그니픽» 보내기는 창에 Ctrl+V 뿐이라 **창**만
/// 뜨면 됩니다. 2026-09-22 검토: 문구를 한 벌로 합치며 «구성» 의 기준(포트)이 보내기에도 씌워져,
/// 콜드 스타트에 창은 15초에 뜨고 포트는 20초 뒤에 열리면 「디버그 포트가 아직 안 열렸습니다 …
/// 완전히 끝내고」 라고 해서, 화면에 멀쩡히 뜬 마그니픽을 사람이 끄게 했습니다.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum LaunchNeed {
    /// 디버그 포트(9556)가 응답해야 — «구성».
    Port,
    /// 데스크톱 창이 보이면 됨 — «마그니픽» 보내기.
    Window,
}

/// [`launch_magnific_desktop_verified`] 의 결과. 문구는 [`launch_outcome_message`] 한 벌로 만듭니다.
pub enum LaunchOutcome {
    /// 켜졌습니다 — 부른 쪽의 기준([`LaunchNeed`])으로. 포트면 우리가 켠 인스턴스가 떠 있는 것.
    Up,
    /// 켜지자마자 꺼졌습니다(종료 코드). 트레이·좀비로 남은 마그니픽이 있으면 새 인스턴스가 넘겨주고 끝나는 모양.
    Exited(Option<i32>),
    /// 창은 떴는데 상한 안에 포트가 안 열렸습니다(포트가 필요한 길에서만). 두 경우가 섞여 있습니다 —
    /// 콜드 스타트가 느려 WebView2 가 아직 포트를 못 연 것(이때는 기다리면 됨)과, 환경변수 없는
    /// 인스턴스가 앞으로 온 것(이때는 끝내고 다시). 여기서는 가릴 수 없어 문구가 둘 다 말합니다.
    WindowNoPort,
    /// 상한 안에 프로세스도 안 죽고 포트도 창도 안 떴습니다.
    Timeout,
}

/// 마그니픽을 켜고 **실제로 떴는지** 확인합니다.
///
/// 2026-09-21 실측: «구성» 이 「마그니픽을 켰습니다」 라고 했는데 마그니픽이 안 떴습니다. 예전
/// `launch_magnific_desktop` 은 spawn 한 Child 를 그 자리에서 버려서, 켜지자마자 꺼져도 «켰다» 고
/// 알렸습니다. 확인 신호 셋(다 이미 있던 재료): ① Child.try_wait 로 생존(upscale.rs 의 고리와 같은
/// 모양) ② `find_app_page` 로 9556 이 열렸는가(NO_PORT 만 «아직», 로그인 화면 등 다른 오류는 포트가
/// 열린 것) ③ 창이 떠 있는가 — 창만 필요한 길은 이것으로 곧 성공, 포트가 필요한 길은 상한에 닿았을
/// 때 «다른 인스턴스가 앞으로 온 것» 의 근거.
///
/// 자식이 곧 꺼졌을 때: 포트는 그 자식의 WebView2 것이라 «구성» 은 바로 실패입니다. 창만 필요한 길은
/// 넘겨받은 인스턴스가 창을 띄울 수 있어 [`HANDOFF_WAIT`] 만큼 더 봅니다 — 그 창이면 붙여넣기에 충분합니다.
pub async fn launch_magnific_desktop_verified(need: LaunchNeed) -> Res<LaunchOutcome> {
    let mut child = launch_magnific_desktop()?;
    let deadline = tokio::time::Instant::now() + LAUNCH_WAIT;
    // 자식이 꺼진 뒤에는 (종료 코드, 창을 더 기다려 줄 마감).
    let mut exited: Option<(Option<i32>, tokio::time::Instant)> = None;
    loop {
        if exited.is_none() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if need == LaunchNeed::Port {
                        return Ok(LaunchOutcome::Exited(status.code()));
                    }
                    exited = Some((status.code(), tokio::time::Instant::now() + HANDOFF_WAIT));
                }
                Ok(None) => {}
                Err(e) => return Err(err("마그니픽 프로세스 상태를 읽지 못했습니다", e)),
            }
        }
        match magnific_cdp::find_app_page().await {
            Err(e) if e == "NO_PORT" => {}
            _ => return Ok(LaunchOutcome::Up),
        }
        if need == LaunchNeed::Window && magnific_window::find_desktop().is_some() {
            return Ok(LaunchOutcome::Up);
        }
        if let Some((code, until)) = exited {
            if tokio::time::Instant::now() >= until {
                return Ok(LaunchOutcome::Exited(code));
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(if magnific_window::find_desktop().is_some() {
                LaunchOutcome::WindowNoPort
            } else {
                LaunchOutcome::Timeout
            });
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

/// 켜기 결과를 사람 말로. «구성»(`compose_body`)과 «마그니픽» 보내기(`send_prompt_to_magnific`)가
/// **같은 한 벌**을 씁니다. 2026-09-21 에 «구성» 만 켜기 확인을 넣고 보내기는 spawn 직후
/// 「실행했습니다」 로 남겨 두었는데, 그 뒤로 보내기는 켰다는데 안 뜨는 일이 그대로였습니다 —
/// 문구를 두 벌 두면 한쪽만 고쳐지는 모양이라 여기 하나로 모읍니다.
/// `button` 은 다시 누를 단추 이름(«구성»·«마그니픽»), `when_up` 은 떴을 때 다음에 할 일.
pub fn launch_outcome_message(outcome: LaunchOutcome, button: &str, when_up: &str) -> String {
    match outcome {
        LaunchOutcome::Up => format!("마그니픽을 켰습니다. {when_up}"),
        LaunchOutcome::Exited(code) => format!(
            "마그니픽을 켰지만 곧 꺼졌습니다(종료 코드 {}). 트레이에 남은 마그니픽을 완전히 끝내고 {button} 을 다시 누르세요. 그래도 안 되면 마그니픽을 직접 켜서 뜨는지 보세요.",
            code.map(|c| c.to_string()).unwrap_or_else(|| "없음".into())
        ),
        // 느린 기동과 «환경변수 없는 옛 창» 을 여기서는 못 가립니다 — 정상 기동 중인 창을 끄라고 단정하면 안 됩니다(2026-09-21 검토).
        LaunchOutcome::WindowNoPort => format!(
            "마그니픽 창은 떴는데 디버그 포트(9556)가 아직 안 열렸습니다. 몇 초 뒤 {button} 을 다시 눌러 보고, 그래도 안 되면 마그니픽을 완전히 끝내고(트레이 포함) 다시 누르세요."
        ),
        LaunchOutcome::Timeout => format!(
            "마그니픽이 {}초 안에 안 떴습니다. 작업 관리자에서 magnific-desktop 이 있는지 보고 {button} 을 다시 누르세요.",
            LAUNCH_WAIT.as_secs()
        ),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeResult {
    message: String,
    fingerprints: Vec<String>,
}

/// «구성» — 그림 올리기 → 생성기까지를 사람 손 없이. 마그니픽 데스크톱을 CDP 로 조종합니다.
///
/// 1. 그림 파일을 클립보드에 넣고 페이지 안 Ctrl+V(안 되면 창 앞으로 + OS Ctrl+V) → 새 노드 감지.
/// 2. 새 노드가 선택돼 있는지 확인(아니면 클릭해 고름) → 페이지 안 Ctrl+C → 클립보드에서 업로드 id 읽기.
/// 올라가는 중이면 id 가 placeholder 라 될 때까지 되풀이.
/// 3. 선택이 **방금 올린 그 노드들과 정확히 같을 때만** Delete(원본은 사본으로 대체되므로 중복).
/// 사용자가 «원본 삭제까지 자동으로» 를 원했고(2026-09-08), 우리가 방금 만든 노드만 지웁니다.
/// 4. 그림 사본 + 생성기(프롬프트·칩) JSON 을 클립보드에 넣고 붙여넣기 → 새 노드 감지.
///
/// 여기는 잠금과 **전체 마감**만 쥡니다. 본체는 [`compose_body`].
#[tauri::command]
pub async fn magnific_compose_auto(
    base_directory: String,
    paths: Vec<String>,
    prompt: String,
    model: String,
    aspect_ratio: String,
    count: u32,
    // "image" 또는 "video".
    // 안 넘기면 예전처럼 이미지입니다(옛 호출을 안 깨뜨리려고).
    kind: Option<String>,
    // 영상일 때 러닝타임(초). 구도잡기 타임라인이 정한 값이 그대로 옵니다.
    duration_seconds: Option<f64>,
) -> Res<ComposeResult> {
    if prompt.trim().is_empty() {
        return Err("보낼 프롬프트가 없습니다.".into());
    }
    // 레퍼런스에 영상이 섞이면 2단계가 변환을 기다리느라(150회 ≈ 4분) 길어지므로 마감도 길게.
    // `kind == "video"` 로 가르면 안 됩니다 — 씬 스토리보드는 kind=video 인데 레퍼런스는 시트 한 장입니다.
    let has_video = paths.iter().any(|p| is_video_path(Path::new(p)));
    let budget = if has_video { COMPOSE_BUDGET_VIDEO } else { COMPOSE_BUDGET_IMAGE };
    // 한 번에 하나. 앞 구성이 끝날 때까지 여기서 기다립니다(화면은 magnific_compose_busy 로 미리 알림).
    let _one_at_a_time = compose_lock().lock().await;
    /*
      ── 전체 마감 ──────────────────────────────────────────────────────
      2026-09-21 실측: «구성» 이 17분째 «구성하는 중…» 에 묶여 있었고, 단추는 잠긴 채 다음 «구성» 은
      «앞 구성이 끝나면 이어서» 만 띄웠습니다. 명령이 안 돌아오니 화면 쪽 finally 가 영영 안 돌았습니다.
      마감은 Rust 한 벌입니다 — TS 에 Promise.race 를 두면 이 명령은 계속 돌며 잠금을 쥐고 있어
      다음 «구성» 도 또 매달립니다.

      잠금을 잡은 **뒤**에 겁니다. 잠금 대기까지 마감에 넣으면 줄 서 있던 구성이 앞 구성이 쓴
      시간만큼 깎여 죽습니다. 마감이 터지면 본체 future 가 drop 되어 CDP 웹소켓도 같이 닫히고,
      잠금 guard 는 이 함수가 쥐고 있으니 돌아갈 때 풀립니다.
    */
    let body = compose_body(base_directory, paths, prompt, model, aspect_ratio, count, kind, duration_seconds, has_video);
    match tokio::time::timeout(budget, body).await {
        Ok(result) => result,
        Err(_) => Err(format!(
            "마그니픽이 응답하지 않아 {}분 만에 «구성» 을 멈췄습니다. 마그니픽 창을 확인하고 다시 누르세요. 캔버스에 반쯤 놓인 노드가 있으면 지우고 누르세요.",
            budget.as_secs() / 60
        )),
    }
}

/// «구성» 전체 마감. 계산상 최악(모든 되풀이가 끝까지 돌 때)은 그림 ≈ 3.7분, 영상 ≈ 7.6분(변환 대기
/// 4분 포함)이라 그보다 ~30% 넉넉히 잡았습니다. 17분 매달림은 여기서 끊깁니다.
const COMPOSE_BUDGET_IMAGE: std::time::Duration = std::time::Duration::from_secs(300);
const COMPOSE_BUDGET_VIDEO: std::time::Duration = std::time::Duration::from_secs(600);

/// 레퍼런스가 영상 파일인가(확장자). 마감 계산과 2단계 되풀이 횟수가 **같은 규칙**을 봐야 해서 한 벌 —
/// 두 곳에 확장자 목록을 따로 적으면 «한 곳만 틀린» 모양이 됩니다.
fn is_video_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("mp4" | "mov" | "webm" | "m4v")
    )
}

/// «구성» 본체. 잠금과 마감은 [`magnific_compose_auto`] 가 밖에서 겁니다 — 여기서는 모릅니다.
/// 단계마다 `cdp.set_stage` 로 이름을 남겨, 페이지가 멈추면 오류 문구에 «어느 단계» 가 찍힙니다.
#[allow(clippy::too_many_arguments)]
async fn compose_body(
    base_directory: String,
    paths: Vec<String>,
    prompt: String,
    model: String,
    aspect_ratio: String,
    count: u32,
    kind: Option<String>,
    duration_seconds: Option<f64>,
    has_video: bool,
) -> Res<ComposeResult> {
    // 페이지 찾기. 포트가 없으면: 마그니픽이 안 떠 있으면 우리가 켜고, 떠 있으면 다시 켜 달라고 합니다.
    let (ws_url, page_url) = match magnific_cdp::find_app_page().await {
        Ok(found) => found,
        Err(e) if e == "NO_PORT" => {
            // 데스크톱 앱만 봅니다 — 크롬의 마그니픽 탭은 막을 까닭이 없습니다(`find_desktop` 주석).
            let running = magnific_window::find_desktop().is_some();
            if running {
                return Err("마그니픽이 우리 앱 밖에서 켜져 있어 자동 구성을 못 합니다. 마그니픽을 닫고 «구성» 을 다시 누르면 자동 모드로 켭니다.".into());
            }
            // 켰다고 바로 말하지 않고 실제로 떴는지 본 뒤 사실대로(`launch_magnific_desktop_verified` 주석).
            return Err(launch_outcome_message(
                launch_magnific_desktop_verified(LaunchNeed::Port).await?,
                "«구성»",
                "로그인해 스페이스 보드를 연 뒤 «구성» 을 다시 누르세요.",
            ));
        }
        Err(e) => return Err(e),
    };
    if !page_url.contains("/app/spaces/") {
        return Err("마그니픽에서 스페이스 보드를 연 뒤 «구성» 을 누르세요.".into());
    }
    let mut cdp = magnific_cdp::Cdp::connect(&ws_url).await?;
    let sleep = |ms: u64| tokio::time::sleep(std::time::Duration::from_millis(ms));
    let set_of = |ids: &[String]| ids.iter().cloned().collect::<std::collections::BTreeSet<_>>();
    // 페이지 안 Ctrl+V 가 안 먹을 때의 예비: 창 앞으로 + 캔버스 클릭 + OS Ctrl+V. HWND 를 await 너머로
    // 들고 가면 future 가 Send 가 아니라서(Tauri 비동기 명령 조건) 동기 클로저 안에서 끝냅니다.
    // 붙인 페이지가 데스크톱 앱이라 OS 붙여넣기도 데스크톱 창에만 — 크롬 탭이 앞에 있어도 그쪽에 붙이면 안 됩니다.
    let paste_by_os = || {
        if let Some(hwnd) = magnific_window::find_desktop() {
            magnific_window::bring_to_front(hwnd);
            std::thread::sleep(std::time::Duration::from_millis(400));
            magnific_window::click_center(hwnd);
            std::thread::sleep(std::time::Duration::from_millis(250));
            magnific_window::paste();
        }
    };

    // 레퍼런스 그림이 없으면(에셋·아직 그림 없는 인물) 올리기·id 읽기·원본 정리를 건너뛰고
    // 프롬프트만 든 생성기를 붙여넣습니다().
    let (creations, removed, fingerprints): (Vec<CopiedCreation>, bool, Vec<String>) = if paths.is_empty() {
        (Vec::new(), true, Vec::new())
    } else {
        // ── 1. 그림 올리기 ──────────────────────────────────────────────────────
        cdp.set_stage("1단계 그림 올리기");
        let (files, fingerprints) = resolve_image_files(&base_directory, &paths)?;
        let wanted_names: Vec<String> = files
            .iter()
            .map(|f| f.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default())
            .collect();
        let before = set_of(&cdp.node_ids(false).await?);
        cdp.key("Escape", 27, false, false).await?;
        magnific_window::set_clipboard_files(&files)?;
        cdp.key("KeyV", 86, true, false).await?;
        let mut new_ids: Vec<String> = Vec::new();
        for _ in 0..40 {
            sleep(250).await;
            let now = cdp.node_ids(false).await?;
            new_ids = now.into_iter().filter(|id| !before.contains(id)).collect();
            if new_ids.len() >= files.len() {
                break;
            }
        }
        if new_ids.is_empty() {
            // 페이지 안 Ctrl+V 가 안 먹으면 OS 로.
            paste_by_os();
            for _ in 0..40 {
                sleep(250).await;
                let now = cdp.node_ids(false).await?;
                new_ids = now.into_iter().filter(|id| !before.contains(id)).collect();
                if new_ids.len() >= files.len() {
                    break;
                }
            }
        }
        if new_ids.is_empty() {
            return Err("그림을 붙여넣었는데 캔버스에 새 노드가 안 생겼습니다.".into());
        }

        // ── 2. 업로드 id 읽기(선택 → 페이지 안 Ctrl+C → 클립보드) ───────────────────
        /*
          ── 영상은 노드가 **늦게** 섭니다 ──────────────────────────────────
          2026-09-21 국호 씬 1 실측: mp4 와 시트를 같이 붙여넣었는데 1번 단계의 10초 안에는 시트 노드만
          생겼고, 영상은 마그니픽이 변환을 끝낸 뒤에야 노드가 섰습니다. 그런데 아래
          복사 고리는 1번에서 잡아 둔 `new_ids` 만 60번 되풀이해 골랐으므로 영상은 한 번도
          선택·복사되지 않았고, 100초 뒤 「업로드 id 를 읽지 못했습니다(복사된 그림:
          [시트])」 로 끝났습니다 — 레퍼런스 영상이 영영 안 걸리는 길입니다.

          그래서 고리마다 «붙여넣기 전에 없던 노드» 를 **다시 줍고**, 영상이 섞여 있으면
          변환 시간을 감안해 더 오래 기다립니다(150 × ~1.7초 ≈ 4분). `has_video` 는 전체 마감을
          정하는 바깥(`magnific_compose_auto`)이 `is_video_path` 로 한 번 계산해 넘겨 줍니다.
        */
        cdp.set_stage("2단계 업로드 id 읽기");
        let copy_tries = if has_video { 150 } else { 60 };
        let mut creations: Vec<CopiedCreation> = Vec::new();
        let mut last_seen = String::new();
        for _ in 0..copy_tries {
            let late: Vec<String> = cdp.node_ids(false).await?.into_iter().filter(|id| !before.contains(id)).collect();
            if late.len() > new_ids.len() {
                new_ids = late;
            }
            let selected = set_of(&cdp.node_ids(true).await?);
            if selected != set_of(&new_ids) {
                cdp.key("Escape", 27, false, false).await?;
                let centers = cdp.node_centers(&new_ids).await?;
                for (i, (_, x, y)) in centers.iter().enumerate() {
                    cdp.click(*x, *y, i > 0).await?;
                    sleep(80).await;
                }
            }
            cdp.key("KeyC", 67, true, false).await?;
            sleep(700).await;
            if let Some(html) = magnific_window::read_clipboard_html() {
                if let Some(encoded) = pikaso::extract(&html) {
                    if let Ok(value) = pikaso::decode(&encoded) {
                        let all = copied_creations(&value);
                        let mut picked: Vec<CopiedCreation> = Vec::new();
                        for c in &all {
                            if wanted_names.iter().any(|n| n == &c.name) && !picked.iter().any(|p| p.name == c.name) {
                                picked.push(c.clone());
                            }
                        }
                        last_seen = format!("복사된 그림: [{}]", all.iter().map(|c| c.name.as_str()).collect::<Vec<_>>().join(", "));
                        if picked.len() >= wanted_names.len() {
                            creations = picked;
                            break;
                        }
                    }
                }
            }
            sleep(1000).await;
        }
        if creations.is_empty() {
            return Err(format!("올린 그림의 업로드 id 를 읽지 못했습니다({last_seen}). 그림이 다 올라간 뒤 다시 누르세요."));
        }

        // ── 3. 원본 지우기 — 선택이 방금 올린 노드들과 정확히 같을 때만 ──────────────
        cdp.set_stage("3단계 원본 지우기");
        let selected = set_of(&cdp.node_ids(true).await?);
        let mut removed = false;
        if selected == set_of(&new_ids) {
            cdp.key("Delete", 46, false, false).await?;
            for _ in 0..12 {
                sleep(250).await;
                let now = set_of(&cdp.node_ids(false).await?);
                if new_ids.iter().all(|id| !now.contains(id)) {
                    removed = true;
                    break;
                }
            }
        }
        (creations, removed, fingerprints)
    };

    // 그림이 없으면 생성기를 지금 보이는 캔버스 가운데에 놓습니다(Vue Flow 변환 행렬로 계산).
    let origin: Option<(f64, f64)> = if creations.is_empty() {
        cdp.set_stage("생성기 자리 잡기");
        let js = r#"(()=>{const p=document.querySelector('.vue-flow__transformationpane');const v=document.querySelector('.vue-flow__viewport')||(p&&p.parentElement);if(!p||!v)return null;const m=new DOMMatrixReadOnly(getComputedStyle(p).transform);const r=v.getBoundingClientRect();return JSON.stringify([(r.width/2-m.e)/m.a-348,(r.height/2-m.f)/m.d-196])})()"#;
        let v = cdp.eval(js).await.unwrap_or(serde_json::Value::Null);
        v.as_str().and_then(|t| serde_json::from_str::<(f64, f64)>(t).ok())
    } else {
        None
    };

    // ── 4. 그림 사본 + 생성기 붙여넣기 ─────────────────────────────────────────
    cdp.set_stage("4단계 사본·생성기 붙여넣기");
    let (payload, gen_count) = build_flow_payload(
        &prompt,
        &creations,
        &model,
        &aspect_ratio,
        count,
        origin,
        kind.as_deref(),
        duration_seconds,
    )?;
    put_flow_on_clipboard(&payload)?;
    let before = set_of(&cdp.node_ids(false).await?);
    cdp.key("Escape", 27, false, false).await?;
    cdp.key("KeyV", 86, true, false).await?;
    let expected = creations.len() + gen_count;
    let mut pasted = 0usize;
    for _ in 0..40 {
        sleep(250).await;
        let now = cdp.node_ids(false).await?;
        pasted = now.iter().filter(|id| !before.contains(*id)).count();
        if pasted >= expected {
            break;
        }
    }
    if pasted == 0 {
        paste_by_os();
        sleep(1500).await;
        let now = cdp.node_ids(false).await?;
        pasted = now.iter().filter(|id| !before.contains(*id)).count();
    }
    if pasted == 0 {
        return Err("그림 사본과 생성기를 붙여넣었는데 캔버스에 안 생겼습니다.".into());
    }
    let mut message = if creations.is_empty() {
        format!("마그니픽 캔버스에 이미지 생성기 {gen_count}개(프롬프트만)를 놓았습니다.")
    } else {
        format!(
            "마그니픽 캔버스에 그림 {}장 + 이미지 생성기 {gen_count}개(프롬프트·칩 포함)를 이어 놓았습니다.",
            creations.len()
        )
    };
    if !removed {
        message.push_str(" 처음 올린 원본 그림은 선택이 바뀌어 지우지 않았습니다 — 중복이면 Delete 로 지우세요.");
    }
    Ok(ComposeResult { message, fingerprints })
}

/// 그림 파일들을 마그니픽 캔버스에 붙여넣습니다. 파일마다 이미지 노드가 됩니다.
///
/// 파일을 클립보드에 넣고(탐색기 복사와 같음) 창을 앞으로 → 캔버스 클릭 → Ctrl+V.
/// 프로젝트 폴더 안의 그림 파일만 보냅니다 — 엉뚱한 경로가 넘어와도 밖으로 안 나갑니다.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendImagesResult {
    message: String,
    /// 보낸 파일들의 지문. 후보함에 되돌아오면 숨기려고 화면이 기억합니다.
    fingerprints: Vec<String>,
}

/// 보낼 그림 파일을 검증해 (탐색기 식 경로, 지문) 으로 돌려줍니다.
pub fn resolve_image_files(base_directory: &str, paths: &[String]) -> Res<(Vec<PathBuf>, Vec<String>)> {
    let base = fs::canonicalize(base_directory).map_err(|e| err("저장 폴더를 찾지 못했습니다", e))?;
    let mut files = vec![];
    for path in paths {
        let target = Path::new(path);
        if !extension_allowed(target) {
            continue;
        }
        let real = ensure_inside(&base, target)?;
        // canonicalize 는 `\?\D:\…` 꼴(verbatim)을 돌려줍니다. 탐색기 복사는 `D:\…` 로
        // 넣고, 크로미움은 `\?\` 경로를 파일로 받지 않았습니다(2026-09-07). 접두를 뗍니다.
        let shown = real.to_string_lossy().to_string();
        let shown = shown
            .strip_prefix(r"\\?\UNC\")
            .map(|rest| format!(r"\\{rest}"))
            .unwrap_or_else(|| shown.strip_prefix(r"\\?\").unwrap_or(&shown).to_string());
        files.push(PathBuf::from(shown));
    }
    if files.is_empty() {
        return Err("보낼 그림 파일이 없습니다. 폴더에 저장된 그림만 보낼 수 있습니다.".into());
    }
    let fingerprints: Vec<String> = files.iter().filter_map(|path| file_fingerprint(path)).collect();
    Ok((files, fingerprints))
}

#[tauri::command]
pub fn send_images_to_magnific(base_directory: String, paths: Vec<String>) -> Res<SendImagesResult> {
    let (files, fingerprints) = resolve_image_files(&base_directory, &paths)?;
    let done = |message: String| Ok(SendImagesResult { message, fingerprints: fingerprints.clone() });

    #[cfg(target_os = "windows")]
    {
        let Some((hwnd, target)) = magnific_window::find_target() else {
            return Err("마그니픽 창을 찾지 못했습니다. 데스크톱 앱을 띄우거나, 크롬에서 마그니픽 탭을 앞에 두세요.".into());
        };
        let label = magnific_window::target_label(target);
        magnific_window::set_clipboard_files(&files)?;
        magnific_window::bring_to_front(hwnd);
        std::thread::sleep(std::time::Duration::from_millis(400));
        if !magnific_window::is_front(hwnd) {
            return done(format!("파일을 클립보드에 넣었습니다. {label} 창이 앞으로 오지 않아 붙여넣지 않았습니다 — 캔버스를 누르고 Ctrl+V 하세요."));
        }
        magnific_window::click_center(hwnd);
        std::thread::sleep(std::time::Duration::from_millis(250));
        magnific_window::paste();
        return done(format!("{label} 캔버스에 {}장 붙여넣었습니다.", files.len()));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = done;
        Err("이 OS 에서는 아직 그림 보내기를 지원하지 않습니다.".into())
    }
}

/// 마그니픽 창이 떠 있으면 프롬프트를 거기 붙여넣고 알림 문구를 돌려줍니다. 창이 없으면 `None` —
/// 켜는 일은 부르는 쪽([`send_prompt_to_magnific`])이 합니다.
///
/// 왜 따로 뗐는가: **막는 함수**입니다 — 창 제어와 `paste_into_new_node` 의 sleep 을 합치면 4초 남짓
/// 스레드를 붙잡습니다. 비동기 명령 안에서 그대로 부르면 tokio 워커 하나가 그만큼 막히고(다른
/// 비동기 명령의 진행이 늦어짐), HWND 가 await 너머로 남아 future 가 Send 가 아니게 됩니다(Tauri
/// 비동기 명령 조건). 그래서 `spawn_blocking` 안에서 부릅니다 — 둘 다 뿌리에서 풀립니다(2026-09-22 검토).
/// 예전 동기 명령은 이 4초 동안 메인 스레드(화면)를 세웠습니다.
#[cfg(target_os = "windows")]
fn paste_prompt_into_window(text: &str) -> Option<String> {
    let (hwnd, target) = magnific_window::find_target()?;
    let label = magnific_window::target_label(target);
    magnific_window::bring_to_front(hwnd);
    std::thread::sleep(std::time::Duration::from_millis(400));
    if text.trim().is_empty() {
        return Some(format!("{label} 창을 앞으로 가져왔습니다."));
    }
    if !magnific_window::is_front(hwnd) {
        return Some(format!("복사했습니다. {label} 창이 앞으로 오지 않아 붙여넣지 않았습니다 — 창을 누르고 Ctrl+V 하세요."));
    }
    // 텍스트 노드를 만들어 그 안에 붙여넣습니다(칩 연결). 왜 이 순서인지는 함수 주석 참조.
    magnific_window::paste_into_new_node(hwnd, "text");
    Some(format!("{label} 캔버스에 텍스트 노드를 만들어 붙여넣었습니다. @태그가 칩으로 이어졌는지 확인하세요."))
}

/// 보내기 알림에 늘 붙는 한 줄. 켜기 확인이 어떻게 끝났든 **프롬프트는 클립보드에 있으니** 그 말은
/// 해야 합니다 — 옛 문구가 늘 달고 있던 힌트인데, 문구를 한 벌로 합치며 켜진 갈래 말고는 빠졌었습니다
/// (2026-09-22 검토). 켜진 갈래·못 켜진 갈래가 같은 이 한 줄을 씁니다.
#[cfg(target_os = "windows")]
const CLIPBOARD_HINT: &str = "화면이 뜨면 캔버스를 누르고 Ctrl+V 하세요 — 프롬프트는 클립보드에 있습니다.";

/// 프롬프트를 클립보드에 넣고 마그니픽 데스크톱 창에 붙여넣습니다.
///
/// 글이 비어 있으면 붙여넣지 않고 창만 앞으로 가져옵니다(연결 확인용).
/// 마그니픽이 안 떠 있으면 켜기만 하고, 붙여넣기는 사람이 합니다 — 로그인
/// 화면이 뜨는 데 시간이 걸리고 어디에 커서가 있을지 알 수 없습니다.
///
/// 왜 async 인가: 2026-09-21 «구성» 이 「켰습니다」 라고 했는데 마그니픽이 안 떴습니다. 이 명령도
/// 같은 원시 spawn 직후 「실행했습니다」 라고 단정했으니 같은 거짓말을 할 수 있었습니다. 동기
/// 명령은 떴는지를 못 기다리므로(sleep 하면 메인 스레드가 멈춤) async 로 바꿔 «구성» 과 같은
/// [`launch_magnific_desktop_verified`] 를 쓰고, 결과마다 사실대로 말합니다. 다만 기준은 **창**입니다
/// ([`LaunchNeed::Window`]) — 보내기는 포트를 안 씁니다.
#[tauri::command]
pub async fn send_prompt_to_magnific(text: String) -> Res<String> {
    // 한 번에 하나 — 켜는 20초 동안 다시 누르면 두 번째 인스턴스를 켜게 됩니다(`SEND_LOCK` 주석).
    // 클립보드보다 먼저 잡습니다. 뒤 누름이 앞 누름의 클립보드를 켜는 도중에 덮어쓰면 안 됩니다.
    let _one_at_a_time = send_lock().lock().await;
    if !text.trim().is_empty() {
        // 잠금(MutexGuard)은 Send 가 아니라 이 블록 안에서 놓습니다 — await 는 아래에서만.
        let _clipboard = clipboard_guard();
        let mut clipboard =
            arboard::Clipboard::new().map_err(|e| err("클립보드를 열지 못했습니다", e))?;
        clipboard
            .set_text(text.clone())
            .map_err(|e| err("클립보드에 넣지 못했습니다", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        // 창 제어는 막는 일이라 블로킹 풀에서(`paste_prompt_into_window` 주석).
        let pasted = {
            let text = text.clone();
            tauri::async_runtime::spawn_blocking(move || paste_prompt_into_window(&text))
                .await
                .map_err(|e| err("마그니픽 창 제어가 끝나지 않았습니다", e))?
        };
        if let Some(message) = pasted {
            return Ok(message);
        }

        // 안 떠 있으면 켭니다 — 디버그 포트를 켜서, 나중에 «구성» 이 자동으로 되게. 창이 보이면 곧 성공.
        let outcome = launch_magnific_desktop_verified(LaunchNeed::Window).await?;
        let up = matches!(outcome, LaunchOutcome::Up);
        let when_up = if text.trim().is_empty() {
            "화면이 뜨면 «마그니픽» 을 다시 누르세요.".to_string()
        } else {
            format!("{CLIPBOARD_HINT} (크롬으로 쓰려면 마그니픽 탭을 앞에 두고 다시 누르세요)")
        };
        let message = launch_outcome_message(outcome, "«마그니픽»", &when_up);
        // 못 켰어도 클립보드에는 있습니다 — 마그니픽이 뜨는 대로 붙여넣으면 됩니다.
        return Ok(if up || text.trim().is_empty() { message } else { format!("{message} {CLIPBOARD_HINT}") });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        Ok("복사했습니다. 이 OS 에서는 창 제어가 없어 마그니픽에서 직접 Ctrl+V 하세요.".into())
    }
}
