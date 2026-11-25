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

!macro customInstall
  ; Chromium's sandboxed child processes run with a restricted token. When the
  ; folder's DACL holds any AppContainer package SID (S-1-15-2-*, usually
  ; inherited from a parent folder where other software left it), Windows
  ; checks that token as if it were an AppContainer: only ALL APPLICATION
  ; PACKAGES (S-1-15-2-1) or ALL RESTRICTED APPLICATION PACKAGES can grant
  ; access. Without such an entry the children cannot read icudtl.dat in their
  ; own folder and the GPU process crash-loops with exit code -2147483645
  ; (electron/electron#51761). Program Files has both entries already; per-user
  ; and custom folders do not, so grant read and execute to both here.
  ;
  ; The app writes crash reports and native dumps to "logs" in this folder when
  ; it is writable (electron/debug/crashLog.cjs), and no sandboxed process reads
  ; them. Create it, stop it inheriting and take the two entries off it, so the
  ; grant does not make them readable to every AppContainer app. The removal
  ; is a separate call because icacls applies /remove before /inheritance:d
  ; when given both, and it is needed because a reinstall or update keeps the
  ; folder and its earlier grant, which a new "logs" then starts out with.
  ;
  ; "$INSTDIR\." keeps the closing quote from being escaped when a silent
  ; install passes /D= with a trailing backslash. The results are thrown away:
  ; a failure must not fail the installation. Nothing to undo on uninstall, the
  ; folder is removed.
  Push $0
  CreateDirectory "$INSTDIR\logs"
  nsExec::Exec /TIMEOUT=60000 '"$SYSDIR\icacls.exe" "$INSTDIR\logs" /inheritance:d'
  Pop $0
  nsExec::Exec /TIMEOUT=60000 '"$SYSDIR\icacls.exe" "$INSTDIR\logs" /remove:g *S-1-15-2-1 *S-1-15-2-2'
  Pop $0
  nsExec::Exec /TIMEOUT=60000 '"$SYSDIR\icacls.exe" "$INSTDIR\." /grant *S-1-15-2-1:(OI)(CI)(RX) *S-1-15-2-2:(OI)(CI)(RX)'
  Pop $0
  Pop $0
!macroend

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
