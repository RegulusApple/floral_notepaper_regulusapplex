!include /CHARSET=UTF8 "${__FILEDIR__}\nsis-data-permissions.nsh"
!include /CHARSET=UTF8 "${__FILEDIR__}\nsis-document-uninstall.nsh"

!macro NSIS_HOOK_PREINSTALL
  ; Keep even a custom install path separate from the upstream release.
  StrLen $R0 "\${PRIVATE_INSTALL_NAME}"
  IntOp $R0 0 - $R0
  StrCpy $R1 "$INSTDIR" "" $R0
  StrCmp $R1 "\${PRIVATE_INSTALL_NAME}" +2
    StrCpy $INSTDIR "$INSTDIR\${PRIVATE_INSTALL_NAME}"
  ; Refresh output path so files are extracted to the (possibly updated) $INSTDIR
  SetOutPath $INSTDIR
  ; Validate data access before copying binaries or writing install records.
  StrCpy $FloralDataGrant 0
  !if "${INSTALLMODE}" == "perMachine"
    StrCpy $FloralDataGrant 1
  !else if "${INSTALLMODE}" == "both"
    ${If} $MultiUser.InstallMode == "AllUsers"
      StrCpy $FloralDataGrant 1
    ${EndIf}
  !endif
  Call FloralPrepareDataDirectory
  ${If} $FloralDataError != ""
    MessageBox MB_OK|MB_ICONSTOP "$FloralDataError$\r$\n安装已中止，已有笔记数据保持不变。" /SD IDOK
    SetErrorLevel 5
    Abort
  ${EndIf}
!macroend
