Unicode true
RequestExecutionLevel user
SilentInstall silent
!include FileFunc.nsh
!define PRIVATE_INSTALL_NAME "floral-notepaper-regulusapplex"
!define INSTALLMODE "both"
Var MultiUser.InstallMode
Var TestResult
!ifdef BROKEN_ICACLS
  !define FLORAL_ICACLS "$EXEDIR\missing-icacls.exe"
!endif
!include /CHARSET=UTF8 "${HOOKS}"
OutFile "${TEST_EXE}"

Function .onInit
  ${GetParameters} $0
  ${GetOptions} $0 "/MODE=" $MultiUser.InstallMode
  ${GetOptions} $0 "/RESULT=" $TestResult
FunctionEnd

Function RecordResult
  FileOpen $0 "$TestResult" w
  FileWriteWord $0 0xFEFF
  FileClose $0
  WriteINIStr "$TestResult" "result" "error" "$FloralDataError"
  WriteINIStr "$TestResult" "result" "sid" "$FloralDataSid"
  WriteINIStr "$TestResult" "result" "grant" "$FloralDataGrantResult"
FunctionEnd

Function .onInstFailed
  Call RecordResult
  SetErrorLevel 5
FunctionEnd

Section
  !insertmacro NSIS_HOOK_PREINSTALL
  Call RecordResult
  SetErrorLevel 0
SectionEnd
