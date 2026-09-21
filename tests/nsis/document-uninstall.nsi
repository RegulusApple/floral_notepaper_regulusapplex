Unicode true
RequestExecutionLevel user
!include MUI2.nsh
!include FileFunc.nsh
!include nsDialogs.nsh
Var PassiveMode
Var UpdateMode
!include /CHARSET=UTF8 "${DOCUMENT_HOOK}"
!insertmacro FloralDocumentUninstallSupport
OutFile "${TEST_EXE}"
!insertmacro MUI_UNPAGE_CONFIRM
UninstPage custom un.FloralDocumentPage un.FloralDocumentPageLeave
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section
  WriteUninstaller "${TEST_UNINSTALLER}"
SectionEnd

Function un.onInit
  StrCpy $FloralDeleteDocument 0
  StrCpy $PassiveMode 0
  StrCpy $UpdateMode 0
  ${GetParameters} $0
  ; Test-only simulation of the radio choice. Production exposes no such flag.
  ${GetOptions} $0 "/CHOICE=" $1
  ${If} $1 == "delete"
    StrCpy $FloralDeleteDocument 1
  ${EndIf}
  ${GetOptions} $0 "/MODE=" $1
  ${If} $1 == "update"
    StrCpy $UpdateMode 1
  ${ElseIf} $1 == "passive"
    StrCpy $PassiveMode 1
  ${EndIf}
FunctionEnd

Section Uninstall
  Call un.FloralApplyDocumentChoice
  FileOpen $0 "$INSTDIR\..\result.ini" w
  FileWriteWord $0 0xFEFF
  FileClose $0
  WriteINIStr "$INSTDIR\..\result.ini" "result" "error" "$FloralDocumentError"
  WriteINIStr "$INSTDIR\..\result.ini" "result" "choice" "$FloralDeleteDocument"
  ${If} $FloralDocumentError != ""
    SetErrorLevel 5
  ${Else}
    Delete "$INSTDIR\application-sentinel.exe"
    SetErrorLevel 0
  ${EndIf}
SectionEnd
