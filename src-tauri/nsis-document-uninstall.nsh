!ifndef FLORAL_DOCUMENT_UNINSTALL_INCLUDED
!define FLORAL_DOCUMENT_UNINSTALL_INCLUDED

!macro FloralDocumentUninstallSupport
Var FloralDeleteDocument
Var FloralDocumentError
Var FloralDocumentKeepRadio
Var FloralDocumentDeleteRadio

Function un.FloralDocumentPage
  ${If} $PassiveMode == 1
  ${OrIf} $UpdateMode == 1
  ${OrIf} ${Silent}
    Abort
  ${EndIf}
  ; An absent or literally empty Document does not need a data decision.
  FindFirst $0 $1 "$INSTDIR\Document\*"
  floral_document_entries:
    ${If} $1 == ""
      FindClose $0
      Abort
    ${EndIf}
    ${If} $1 != "."
    ${AndIf} $1 != ".."
      FindClose $0
      Goto floral_document_show
    ${EndIf}
    FindNext $0 $1
    Goto floral_document_entries
  floral_document_show:
  !insertmacro MUI_HEADER_TEXT "卸载时如何处理笔记数据" "请选择是否保留 Document 中的内容。"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 42u "Document 中包含笔记、图片或其他用户数据。$\r$\n删除前建议先进行备份。$\r$\n是否删除 Document 及其中的全部数据？"
  Pop $0
  ${NSD_CreateRadioButton} 0 58u 100% 16u "保留数据并卸载"
  Pop $FloralDocumentKeepRadio
  ${NSD_CreateRadioButton} 0 82u 100% 16u "删除数据并卸载"
  Pop $FloralDocumentDeleteRadio
  ${If} $FloralDeleteDocument == 1
    ${NSD_Check} $FloralDocumentDeleteRadio
  ${Else}
    ${NSD_Check} $FloralDocumentKeepRadio
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function un.FloralDocumentPageLeave
  ${NSD_GetState} $FloralDocumentDeleteRadio $FloralDeleteDocument
FunctionEnd

; Remove entries without following directory junctions/symbolic links. The
; only entry point below validates Document and its installation ancestors.
Function un.FloralRemoveDocumentTree
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  FindFirst $1 $2 "$0\*"
  floral_remove_next:
    ${If} $2 == ""
      Goto floral_remove_done
    ${EndIf}
    ${If} $2 != "."
    ${AndIf} $2 != ".."
      System::Call 'kernel32::GetFileAttributesW(w "$0\$2") i .r3'
      ${If} $3 == -1
        StrCpy $FloralDocumentError "无法访问 Document 中的文件：$0\$2"
        Goto floral_remove_done
      ${EndIf}
      IntOp $4 $3 & 0x10
      ${If} $4 <> 0
        IntOp $4 $3 & 0x400
        ${If} $4 <> 0
          ClearErrors
          RMDir "$0\$2"
          ${If} ${Errors}
            StrCpy $FloralDocumentError "无法删除 Document 中的目录链接：$0\$2"
          ${EndIf}
        ${Else}
          Push "$0\$2"
          Call un.FloralRemoveDocumentTree
        ${EndIf}
      ${Else}
        ClearErrors
        Delete "$0\$2"
        ${If} ${Errors}
          StrCpy $FloralDocumentError "无法删除 Document 中的文件：$0\$2"
        ${EndIf}
      ${EndIf}
      ${If} $FloralDocumentError != ""
        Goto floral_remove_done
      ${EndIf}
    ${EndIf}
    FindNext $1 $2
    Goto floral_remove_next
  floral_remove_done:
  FindClose $1
  ${If} $FloralDocumentError == ""
    ClearErrors
    RMDir "$0"
    ${If} ${Errors}
      StrCpy $FloralDocumentError "无法删除 Document 目录：$0"
    ${EndIf}
  ${EndIf}
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function un.FloralApplyDocumentChoice
  StrCpy $FloralDocumentError ""
  ; There is no command-line option to authorize data deletion. Only the
  ; interactive page can select it; updates/passive removal always keep data.
  ${If} $UpdateMode == 1
  ${OrIf} $PassiveMode == 1
    Return
  ${EndIf}
  ${If} $FloralDeleteDocument <> 1
    ; Keep means no recursive deletion, even if the user supplied a junction.
    System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR\Document") i .r0'
    IntOp $1 $0 & 0x400
    ${If} $0 != -1
    ${AndIf} $1 == 0
      RMDir "$INSTDIR\Document"
    ${EndIf}
    Return
  ${EndIf}
  ${If} $INSTDIR == ""
    StrCpy $FloralDocumentError "无法确定安装目录，未删除 Document。"
    Return
  ${EndIf}
  GetFullPathName $0 "$INSTDIR"
  GetFullPathName $1 "$0\.."
  ${If} $0 == $1
    StrCpy $FloralDocumentError "安装目录无效，未删除 Document。"
    Return
  ${EndIf}
  ; Reject redirected installation roots, including junctions in ancestors.
  floral_check_ancestor:
    System::Call 'kernel32::GetFileAttributesW(w r0) i .r2'
    IntOp $2 $2 & 0x400
    ${If} $2 <> 0
      StrCpy $FloralDocumentError "安装目录不可访问或包含目录链接，未删除 Document。"
      Return
    ${EndIf}
    GetFullPathName $1 "$0\.."
    ${If} $0 != $1
      StrCpy $0 $1
      Goto floral_check_ancestor
    ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR\Document") i .r0'
  ${If} $0 == -1
    System::Call 'kernel32::GetLastError() i .r1'
    ${If} $1 != 2
    ${AndIf} $1 != 3
      StrCpy $FloralDocumentError "无法访问 Document，请检查权限后重试。"
    ${EndIf}
    Return
  ${EndIf}
  IntOp $1 $0 & 0x400
  IntOp $2 $0 & 0x10
  ${If} $1 <> 0
  ${OrIf} $2 == 0
    StrCpy $FloralDocumentError "Document 不是普通文件夹，未删除其中的数据。"
    Return
  ${EndIf}
  Push "$INSTDIR\Document"
  Call un.FloralRemoveDocumentTree
FunctionEnd
!macroend
!endif
