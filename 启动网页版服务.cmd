@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
rem 两个快捷入口使用同一套 3.6.0 Java/MySQL 检查与启动流程，防止版本说明再次分叉。
call "%~dp0启动网页版.cmd"
exit /b %ERRORLEVEL%
