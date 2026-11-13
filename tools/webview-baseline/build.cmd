@echo off
rem WebView2 の空のウィンドウだけを開くアプリ（scripts/measure-memory.ps1 -Baseline 用）をビルドする。CARGO_TARGET_DIR を設定してから実行する。
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSDIR=%%i"
if not defined VSDIR set "VSDIR=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools"
call "%VSDIR%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
cd /d "%~dp0"
cargo build --release
