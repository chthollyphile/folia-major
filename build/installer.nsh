LangString foliaUserDataPrompt 1033 "Delete user data?"
LangString foliaUserDataPrompt 2052 "是否删除用户数据？"
LangString foliaUserDataPrompt 1057 "Hapus data pengguna?"
LangString foliaUserDataPrompt 1066 "Xóa dữ liệu người dùng?"

LangString foliaInstallerInsideInstDir 1033 "The installer is inside the installation folder:$\r$\n$INSTDIR$\r$\n$\r$\nMove the installer somewhere else (such as the Desktop or Downloads) and run it again."
LangString foliaInstallerInsideInstDir 2052 "安装程序位于安装目录内：$\r$\n$INSTDIR$\r$\n$\r$\n请把安装程序移到其他位置（例如桌面或下载文件夹）后重新运行。"
LangString foliaInstallerInsideInstDir 1057 "Penginstal berada di dalam folder instalasi:$\r$\n$INSTDIR$\r$\n$\r$\nPindahkan penginstal ke tempat lain (misalnya Desktop atau Unduhan), lalu jalankan lagi."
LangString foliaInstallerInsideInstDir 1066 "Trình cài đặt đang nằm trong thư mục cài đặt:$\r$\n$INSTDIR$\r$\n$\r$\nHãy chuyển trình cài đặt sang nơi khác (ví dụ Màn hình nền hoặc Tải xuống) rồi chạy lại."

!ifndef BUILD_UNINSTALLER
  ; electron-builder's running-app check treats every process whose path
  ; starts with $INSTDIR as the app, so an installer placed inside the
  ; installation folder finds itself and hangs while trying to close it.
  ; Defining customCheckAppRunning skips the template's own include of
  ; getProcessInfo.nsh and its pid variable, so bring them in here.
  !include "getProcessInfo.nsh"
  Var pid

  !macro customCheckAppRunning
    StrLen $R0 "$INSTDIR\"
    StrCpy $R1 "$EXEDIR\" $R0
    ${if} $R1 == "$INSTDIR\"
      MessageBox MB_OK|MB_ICONSTOP "$(foliaInstallerInsideInstDir)" /SD IDOK
      Quit
    ${endif}

    !insertmacro IS_POWERSHELL_AVAILABLE
    !insertmacro _CHECK_APP_RUNNING
  !macroend
!endif

!macro customUnInstall
  ; Electron always uses per-user app data, so look under the current user's
  ; roaming profile even when the installation itself is per-machine.
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}

  IfFileExists "$APPDATA\${APP_FILENAME}\*.*" 0 folia_skipUserDataPrompt

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "$(foliaUserDataPrompt)" /SD IDNO IDYES folia_deleteUserData
  Goto folia_skipUserDataPrompt

  folia_deleteUserData:
    RMDir /r "$APPDATA\${APP_FILENAME}"
    !ifdef APP_PRODUCT_FILENAME
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
    !endif
    !ifdef APP_PACKAGE_NAME
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    !endif

  folia_skipUserDataPrompt:
  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}
!macroend
