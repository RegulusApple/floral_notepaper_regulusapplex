!ifndef FLORAL_DATA_PERMISSIONS_INCLUDED
!define FLORAL_DATA_PERMISSIONS_INCLUDED
!include LogicLib.nsh

; No account names or environment variables are passed to icacls. Resolve the
; installing user's SID from the process token and check access using the linked
; non-elevated token, when present. An elevated write probe alone is misleading.
Var FloralDataToken
Var FloralDataSid
Var FloralDataError
Var FloralDataWritable
Var FloralDataGrant
Var FloralDataGrantResult
Var FloralDataProbeDir

!ifndef FLORAL_ICACLS
  !define FLORAL_ICACLS "$SYSDIR\icacls.exe"
!endif

Function FloralOpenDataToken
  StrCpy $FloralDataToken 0
  StrCpy $FloralDataSid ""
  System::Call 'kernel32::GetCurrentProcess() p.r0'
  ; TOKEN_QUERY | TOKEN_DUPLICATE
  System::Call 'advapi32::OpenProcessToken(p r0, i 10, *p .r1) i.r0'
  ${If} $0 == 0
    StrCpy $FloralDataError "无法读取当前安装用户的安全身份。"
    Return
  ${EndIf}
  StrCpy $FloralDataToken $1

  ; TokenElevationType (18): use TokenLinkedToken (19) only for a full token (2).
  System::Call 'advapi32::GetTokenInformation(p r1, i 18, *i .r2, i 4, *i .r3) i.r0'
  ${If} $0 == 0
    StrCpy $FloralDataError "无法检查当前用户的普通运行权限。"
    Return
  ${EndIf}
  ${If} $2 == 2
    System::Call 'advapi32::GetTokenInformation(p r1, i 19, *p .r2, i ${NSIS_PTR_SIZE}, *i .r3) i.r0'
    ${If} $0 == 0
      StrCpy $FloralDataError "无法读取当前用户的普通权限令牌。"
      Return
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r1)'
    StrCpy $FloralDataToken $2
  ${EndIf}

  ; TOKEN_USER plus a maximum-length SID fits in 256 bytes on both architectures.
  System::Alloc 256
  Pop $2
  ${If} $2 == 0
    StrCpy $FloralDataError "无法分配用户身份缓冲区。"
    Return
  ${EndIf}
  System::Call 'advapi32::GetTokenInformation(p $FloralDataToken, i 1, p r2, i 256, *i .r3) i.r0'
  ${If} $0 != 0
    System::Call '*$2(p .r3)'
    System::Call 'advapi32::ConvertSidToStringSidW(p r3, *p .r4) i.r0'
    ${If} $0 != 0
      System::Call '*$4(&w${NSIS_MAX_STRLEN} .r5)'
      StrCpy $FloralDataSid $5
      System::Call 'kernel32::LocalFree(p r4)'
    ${EndIf}
  ${EndIf}
  System::Free $2
  ${If} $FloralDataSid == ""
    StrCpy $FloralDataError "无法获取当前安装用户的 SID。"
  ${EndIf}
FunctionEnd

Function FloralProbeDataDirectory
  ${If} $FloralDataWritable == 0
    Return
  ${EndIf}
  ; Require read/list access as well as write access to this existing directory.
  System::Call 'kernel32::CreateFileW(w "$FloralDataProbeDir", i 0xC0000000, i 7, p 0, i 3, i 0x02000000, p 0) p.r0 ?e'
  Pop $3
  ${If} $0 != -1
    System::Call 'kernel32::CloseHandle(p r0)'
    ; GetTempFileName creates a unique file, never truncating a user's document.
    System::Call 'kernel32::GetTempFileNameW(w "$FloralDataProbeDir", w "flr", i 0, w .r2) i.r0 ?e'
    Pop $3
    ${If} $0 != 0
      ; GENERIC_READ | GENERIC_WRITE | DELETE, OPEN_EXISTING, DELETE_ON_CLOSE.
      System::Call 'kernel32::CreateFileW(w r2, i 0xC0010000, i 0, p 0, i 3, i 0x04000000, p 0) p.r0 ?e'
      Pop $3
      ${If} $0 != -1
        System::Call 'kernel32::CloseHandle(p r0)'
        Return
      ${EndIf}
      System::Call 'kernel32::DeleteFileW(w r2)'
    ${EndIf}
  ${EndIf}
  StrCpy $FloralDataWritable 0
  StrCpy $FloralDataError "当前用户无法读写数据目录：$FloralDataProbeDir（Windows 错误 $3）。请选择可写的安装位置，或使用所有用户安装来配置权限。"
FunctionEnd

Function FloralCheckDataAccess
  StrCpy $FloralDataWritable 0
  StrCpy $FloralDataError ""
  System::Call 'advapi32::ImpersonateLoggedOnUser(p $FloralDataToken) i.r0'
  ${If} $0 == 0
    StrCpy $FloralDataError "无法验证当前用户的普通运行权限。"
    Return
  ${EndIf}
  StrCpy $FloralDataWritable 1
  !macro FloralProbeSubdirectory SUFFIX
    StrCpy $FloralDataProbeDir "$INSTDIR\Document${SUFFIX}"
    Call FloralProbeDataDirectory
  !macroend
  !insertmacro FloralProbeSubdirectory ""
  !insertmacro FloralProbeSubdirectory "\diary"
  !insertmacro FloralProbeSubdirectory "\weekly"
  !insertmacro FloralProbeSubdirectory "\monthly"
  !insertmacro FloralProbeSubdirectory "\tiles"
  System::Call 'advapi32::RevertToSelf() i.r0'
  ${If} $0 == 0
    ; Do not continue installing while impersonating a different security token.
    SetErrorLevel 5
    Quit
  ${EndIf}
FunctionEnd

Function FloralPrepareDataDirectory
  System::Store "s"
  StrCpy $FloralDataError ""
  StrCpy $FloralDataGrantResult "skipped"
  StrCpy $FloralDataToken 0
  ClearErrors
  CreateDirectory "$INSTDIR\Document"
  CreateDirectory "$INSTDIR\Document\diary"
  CreateDirectory "$INSTDIR\Document\weekly"
  CreateDirectory "$INSTDIR\Document\monthly"
  CreateDirectory "$INSTDIR\Document\tiles"
  ${If} ${Errors}
    StrCpy $FloralDataError "无法创建数据目录 $INSTDIR\Document。请检查安装位置的写入权限。"
    Goto floral_data_done
  ${EndIf}

  Call FloralOpenDataToken
  ${If} $FloralDataError != ""
    Goto floral_data_done
  ${EndIf}
  ${If} $FloralDataGrant == 1
    ; Grant Modify only on Document; never change the installation root ACL.
    ; Do not enable/disable inheritance or grant access to a broad user group.
    nsExec::ExecToStack /TIMEOUT=30000 '"${FLORAL_ICACLS}" "$INSTDIR\Document" /grant:r "*$FloralDataSid:(OI)(CI)M"'
    Pop $FloralDataGrantResult
    Pop $0
    DetailPrint "Document ACL: exit=$FloralDataGrantResult; $0"
  ${EndIf}
  ; CurrentUser skips ACL changes. For AllUsers, a failed grant is tolerable only
  ; when this real, non-elevated read/write/delete check succeeds afterwards.
  Call FloralCheckDataAccess
  ${If} $FloralDataError == ""
    DetailPrint "Document: 当前用户普通权限读写检查通过。"
  ${Else}
    DetailPrint "$FloralDataError (ACL: $FloralDataGrantResult)"
  ${EndIf}

  floral_data_done:
  ${If} $FloralDataToken != 0
    System::Call 'kernel32::CloseHandle(p $FloralDataToken)'
    StrCpy $FloralDataToken 0
  ${EndIf}
  System::Store "l"
FunctionEnd
!endif
