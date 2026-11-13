@echo off
rem ZigzaguMap build helper. Works from cmd, PowerShell and Git Bash.
rem Git Bash puts its own link.exe first on PATH, so load the MSVC environment first.
rem   scripts\build.cmd          -> pnpm tauri build (release exe)
rem   scripts\build.cmd check    -> cargo check only
rem   scripts\build.cmd clippy   -> cargo clippy (Rust lint; warnings fail)
rem   scripts\build.cmd debug    -> pnpm tauri build --debug
setlocal
set "ROOT=%~dp0.."

if defined VCToolsInstallDir goto :ready
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VSDIR="
if exist "%VSWHERE%" (
  for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSDIR=%%i"
)
if not defined VSDIR set "VSDIR=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools"
if not exist "%VSDIR%\VC\Auxiliary\Build\vcvars64.bat" (
  echo vcvars64.bat not found. Install "Desktop development with C++" of Visual Studio Build Tools.
  exit /b 1
)
call "%VSDIR%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1

:ready
if /i "%~1"=="clippy" (
  cd /d "%ROOT%\apps\desktop\src-tauri" || exit /b 1
  cargo clippy --all-targets -- -D warnings || exit /b 1
  exit /b 0
)
if /i "%~1"=="check" (
  cd /d "%ROOT%\apps\desktop\src-tauri" || exit /b 1
  cargo check || exit /b 1
  exit /b 0
)
cd /d "%ROOT%\apps\desktop" || exit /b 1
if /i "%~1"=="debug" (
  pnpm tauri build --debug
) else (
  pnpm tauri build
)
exit /b %ERRORLEVEL%
