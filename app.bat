@echo off
rem Mononmani Welding Works - single launcher (dev / build / open)
setlocal
cd /d "%~dp0"
set "MINGW=C:\Users\Asus\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
set "PATH=%MINGW%;%PATH%"

if /i "%~1"=="dev"   goto dev
if /i "%~1"=="build" goto build
if /i "%~1"=="open"  goto open

echo ==== Mononmani Welding Works ====
echo   1. Run in development mode
echo   2. Build release executable
echo   3. Open built app
echo.
choice /c 123 /n /m "Choose 1-3: "
if errorlevel 3 goto open
if errorlevel 2 goto build
goto dev

:dev
call npm run tauri dev
goto end

:build
call npm run tauri build
echo Build complete. Run "app.bat open" to launch.
goto end

:open
start "" "%~dp0src-tauri\target\release\manonmani_welding_works.exe"
goto :eof

:end
pause
