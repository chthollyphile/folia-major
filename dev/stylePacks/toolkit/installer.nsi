; Independent, per-user authoring tools. The Folia player and its settings are never modified.
Unicode true
!include "MUI2.nsh"
Name "Folia Style Tools ${VERSION}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\FoliaStyleTools"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "${WIN_VERSION}"
VIAddVersionKey /LANG=1033 "ProductName" "Folia Style Tools"
VIAddVersionKey /LANG=1033 "FileDescription" "Folia MCP and Style Studio installer"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Folia contributors; AGPL-3.0"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${STAGE}\LICENSE.txt"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "Indonesian"
!insertmacro MUI_LANGUAGE "Vietnamese"
LangString Studio ${LANG_ENGLISH} "Style Studio"
LangString Studio ${LANG_SIMPCHINESE} "风格调试器"
LangString Studio ${LANG_INDONESIAN} "Studio Gaya"
LangString Studio ${LANG_VIETNAMESE} "Studio phong cách"
LangString Test ${LANG_ENGLISH} "Test MCP interfaces"
LangString Test ${LANG_SIMPCHINESE} "测试 MCP 接口"
LangString Test ${LANG_INDONESIAN} "Uji antarmuka MCP"
LangString Test ${LANG_VIETNAMESE} "Kiểm tra giao diện MCP"
LangString Config ${LANG_ENGLISH} "Export client configurations"
LangString Config ${LANG_SIMPCHINESE} "导出客户端配置"
LangString Config ${LANG_INDONESIAN} "Ekspor konfigurasi klien"
LangString Config ${LANG_VIETNAMESE} "Xuất cấu hình máy khách"
LangString Guide ${LANG_ENGLISH} "Installation and testing guide"
LangString Guide ${LANG_SIMPCHINESE} "安装与测试指南"
LangString Guide ${LANG_INDONESIAN} "Panduan instalasi dan pengujian"
LangString Guide ${LANG_VIETNAMESE} "Hướng dẫn cài đặt và kiểm tra"
Section "Tools"
    SetShellVarContext current
    SetOutPath "$INSTDIR"
    File /r "${STAGE}\*"
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    CreateDirectory "$SMPROGRAMS\Folia Style Tools"
    CreateShortcut "$SMPROGRAMS\Folia Style Tools\$(Studio).lnk" "$INSTDIR\app\studio\StyleStudio.html"
    CreateShortcut "$SMPROGRAMS\Folia Style Tools\$(Test).lnk" "$SYSDIR\cmd.exe" '/k $\"$\"$INSTDIR\folia-style.cmd$\" self-test$\"'
    CreateShortcut "$SMPROGRAMS\Folia Style Tools\$(Config).lnk" "$SYSDIR\cmd.exe" '/k $\"$\"$INSTDIR\folia-style.cmd$\" configs$\"'
    CreateShortcut "$SMPROGRAMS\Folia Style Tools\$(Guide).lnk" "$INSTDIR\README.md"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoliaStyleTools" "DisplayName" "Folia Style Tools"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoliaStyleTools" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoliaStyleTools" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoliaStyleTools" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoliaStyleTools" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoliaStyleTools" "NoRepair" 1
SectionEnd
Section "Uninstall"
    SetShellVarContext current
    !include "${REMOVE_FILES}"
    Delete "$INSTDIR\Uninstall.exe"
    RMDir "$INSTDIR"
    ; Delete only product shortcuts; no recursive deletion of user-owned directories.
    Delete "$SMPROGRAMS\Folia Style Tools\Style Studio.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\风格调试器.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\Studio Gaya.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\Studio phong cách.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\Test MCP interfaces.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\测试 MCP 接口.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\Uji antarmuka MCP.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\Kiểm tra giao diện MCP.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\Export client configurations.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\导出客户端配置.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\Ekspor konfigurasi klien.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\Xuất cấu hình máy khách.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\Installation and testing guide.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\安装与测试指南.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\Panduan instalasi dan pengujian.lnk"
    Delete "$SMPROGRAMS\Folia Style Tools\Hướng dẫn cài đặt và kiểm tra.lnk"
    RMDir "$SMPROGRAMS\Folia Style Tools"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoliaStyleTools"
SectionEnd
