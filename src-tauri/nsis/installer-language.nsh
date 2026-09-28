; Carry the NSIS language choice into the app's first launch.
; LANGUAGE uses Windows LANGIDs: en 1033, ja 1041, ko 1042, zh-CN 2052.
!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  StrCpy $0 "en"
  StrCmp $LANGUAGE "1042" 0 +2
    StrCpy $0 "ko"
  StrCmp $LANGUAGE "1041" 0 +2
    StrCpy $0 "ja"
  StrCmp $LANGUAGE "2052" 0 +2
    StrCpy $0 "zh"
  CreateDirectory "$APPDATA\AIMovieStorage"
  FileOpen $1 "$APPDATA\AIMovieStorage\installer-language.txt" w
  FileWrite $1 $0
  FileClose $1
  Pop $1
  Pop $0
!macroend
