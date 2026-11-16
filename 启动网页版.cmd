@echo off
chcp 65001 >nul
setlocal
title 三一匠造 3.6.0 - Java/MySQL 网页服务
cd /d "%~dp0"

if not exist "server\java-platform.cjs" goto missing_project
where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "if (Number(process.versions.node.split('.')[0]) < 18) process.exit(1)"
if errorlevel 1 goto old_node

echo 三一匠造 3.6.0 - Java/MySQL 工程装备服务平台
echo.
echo 正在启动随包 Java 与独立 MySQL 服务……
echo 首次启动会初始化本应用自己的数据库，不启动或修改系统 MySQL 服务。
echo 默认数据目录："%APPDATA%\sany-forge-platform-java"
echo 旧 SQLite 数据需要显式导入，不会自动读取或覆盖。
echo 看到启动成功地址后，请在浏览器打开：
echo 客户端：http://127.0.0.1:8790/?workspace=customer#catalog
echo 工作人员：http://127.0.0.1:8790/staff.html
echo.
echo 使用期间请保留此窗口。退出时按 Ctrl+C。
echo 如果软件版已运行，可直接访问上方地址，无需重复启动。
echo.
node server/java-platform.cjs
set "SANY_WEB_EXIT=%ERRORLEVEL%"
echo.
echo 本机服务已停止。若提示端口占用，请确认平台是否已经运行。
echo 按任意键关闭此窗口。
pause >nul
exit /b %SANY_WEB_EXIT%

:missing_node
echo 未找到 Node.js。此脚本不会自动安装软件。
echo 推荐直接打开 Windows 便携版，无需另装 Node.js：
echo "%~dp0..\三一匠造-客服工作台-Windows便携版.exe"
echo 也可以在已有 Node.js 18 或更高版本的电脑运行此脚本。
echo Node.js 仅负责启动随包 Java/MySQL，业务后端由 Java 执行。
pause
exit /b 1

:old_node
echo 当前 Node.js 版本低于 18，无法使用本平台的进程启动器。
echo 请使用 Windows 便携版，或在已有 Node.js 18 或更高版本的环境运行。
pause
exit /b 1

:missing_project
echo 缺少 server\java-platform.cjs，请在完整项目目录中运行此脚本。
pause
exit /b 1
