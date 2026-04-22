@echo off
title PinVault Offline Engine Server

echo =======================================
echo     PinVault Offline Engine
echo =======================================
echo.

if not exist "dist/index.html" (
    echo [ERROR] The app is not built. 
    echo Please run "cmd.exe /c npm run build" first to generate the "dist" folder.
    echo.
    pause
    exit /b
)

echo [*] Starting Local Engine...

REM Attempt 1: Node.js (Very fast local server)
call where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [*] Node.js detected. Launching custom offline server...
    node server.cjs
    if %ERRORLEVEL% NEQ 0 (
        echo [!] Server crashed or port is in use.
        pause
    )
    exit /b
)

REM Attempt 2: Python 3
python --version >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [*] Python detected. Launching custom offline server...
    python server.py
    echo.
    echo [!] Server process ended.
    pause
    exit /b
)

echo [!] Error: No local server runtime found (Python or Node.js).
echo To run this application locally, you must install Python or Node.js.
echo.
pause
