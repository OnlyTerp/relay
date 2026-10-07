@echo off
cd /d "%~dp0app"
if not exist node_modules\electron\dist\electron.exe (
  echo Electron is missing. Run setup.bat first.
  pause & exit /b 1
)
start "" node_modules\electron\dist\electron.exe .
