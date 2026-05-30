@echo off
chcp 65001 >nul
title Tauri App 启动器
echo ========================================
echo   Tauri 桌面应用启动中...
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] 启动 Vite 前端服务器...
echo [2/2] 编译并启动 Tauri 桌面窗口...
echo.

npm run tauri dev

pause
