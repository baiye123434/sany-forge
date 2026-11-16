@echo off
chcp 65001 >nul
setlocal
title 三一匠造 3.7.3 员工工作台构建
cd /d "%~dp0"
echo 将执行Java编译、正常启动版与便携版同步构建和独立数据成品验收。
echo 需要完整JDK17、Maven和Node.js；如默认镜像不可用，可先设置MAVEN_SETTINGS。
call npm run desktop:build
if errorlevel 1 goto failed
node scripts/verify-packaged.cjs
if errorlevel 1 goto failed
call npm run installer:build
if errorlevel 1 goto failed
echo 正常启动版、便携版和离线安装包已完成，成品位于release/service-3.7.3及service-3.7.3-offline-installer。
pause
exit /b 0
:failed
echo 构建或验收失败，请查看上述错误；不要交付失败成品。
pause
exit /b 1
