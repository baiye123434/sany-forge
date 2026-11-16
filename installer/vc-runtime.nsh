!define VC_RUNTIME_SCRIPT "${__FILEDIR__}\..\runtime\installer\offline-vc-runtime.ps1"
!define VC_RUNTIME_INSTALLER "${__FILEDIR__}\..\runtime\installer\vc_redist.x64.exe"
!define LAN_FIREWALL_RULE "SANY Forge Customer LAN 8790"

!macro customInit
  ; Electron 44 与随包的最新版 VC++ 运行库均要求 Windows 10 或更高版本。
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP|MB_OK "此安装包仅支持 64 位 Windows 10 或 Windows 11。"
    Abort
  ${EndIf}

  ; 在旧版卸载和新程序写入前完成离线依赖预检，失败时不改动已有安装。
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "/oname=offline-vc-runtime.ps1" "${VC_RUNTIME_SCRIPT}"
  File "/oname=vc_redist.x64.exe" "${VC_RUNTIME_INSTALLER}"
  DetailPrint "检查 MySQL 所需的 Microsoft Visual C++ x64 运行库..."
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\offline-vc-runtime.ps1" -RedistributablePath "$PLUGINSDIR\vc_redist.x64.exe"'
  Pop $0
  Pop $1
  DetailPrint "$1"
  StrCmp $0 "0" done
  StrCmp $0 "10" reboot
  MessageBox MB_ICONSTOP|MB_OK "Visual C++ x64 运行库离线检测或安装失败。请确认安装包完整，并以管理员身份重新运行。"
  Abort
reboot:
  SetRebootFlag true
  MessageBox MB_ICONINFORMATION|MB_OK "Visual C++ x64 运行库已安装。安装完成后请重新启动电脑，再运行三一匠造。"
done:
!macroend

!macro customInstall
  ; 仅允许同一局域网网段访问随包 Java 的 8790 端口，其他远程地址仍由防火墙阻断。
  nsExec::ExecToStack '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="${LAN_FIREWALL_RULE}"'
  Pop $0
  Pop $1
  nsExec::ExecToStack '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="${LAN_FIREWALL_RULE}" dir=in action=allow program="$INSTDIR\resources\runtime\java\bin\java.exe" enable=yes profile=any protocol=TCP localport=8790 remoteip=localsubnet'
  Pop $0
  Pop $1
  DetailPrint "$1"
  StrCmp $0 "0" firewall_done
  MessageBox MB_ICONEXCLAMATION|MB_OK "程序已安装，但手机局域网访问规则配置失败。请以管理员身份重新运行安装包进行修复。"
firewall_done:
!macroend

!macro customUnInstall
  ; 卸载时只移除本产品命名的防火墙规则，不触碰其他程序规则。
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="${LAN_FIREWALL_RULE}"'
!macroend
