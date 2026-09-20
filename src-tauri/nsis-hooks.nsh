!macro NSIS_HOOK_PREINSTALL
  ; Keep even a custom install path separate from the upstream release.
  StrLen $R0 "\${PRIVATE_INSTALL_NAME}"
  IntOp $R0 0 - $R0
  StrCpy $R1 "$INSTDIR" "" $R0
  StrCmp $R1 "\${PRIVATE_INSTALL_NAME}" +2
    StrCpy $INSTDIR "$INSTDIR\${PRIVATE_INSTALL_NAME}"
  ; Refresh output path so files are extracted to the (possibly updated) $INSTDIR
  SetOutPath $INSTDIR
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; User data belongs to the installing user, not Common Documents.
  ; Reinstalling only ensures empty roots; never overwrite or migrate notes.
  SetShellVarContext current
  CreateDirectory "$DOCUMENTS\花笺-RegulusApplEx\notes\diary"
  CreateDirectory "$DOCUMENTS\花笺-RegulusApplEx\notes\weekly"
  CreateDirectory "$DOCUMENTS\花笺-RegulusApplEx\notes\monthly"
  CreateDirectory "$DOCUMENTS\花笺-RegulusApplEx\notes\tiles"
  !insertmacro SetContext
!macroend
