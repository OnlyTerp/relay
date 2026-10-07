@echo off
REM Relay setup for Windows. Needs Node.js 18+.
cd /d "%~dp0cli"
if exist node_modules rmdir /s /q node_modules
call npm install --omit=dev || goto :err
call npm install -g . || goto :err
node "%~dp0cli\relay.js" install || goto :err
cd /d "%~dp0app"
call npm install || goto :err
call :electron
echo.
echo Done. Start Relay with start.bat
pause
exit /b 0

:electron
REM Electron's postinstall download sometimes leaves an empty dist folder; repair it.
if exist node_modules\electron\dist\electron.exe exit /b 0
echo Fetching Electron...
if exist node_modules\electron\dist rmdir /s /q node_modules\electron\dist
node node_modules\electron\install.js
if exist node_modules\electron\dist\electron.exe exit /b 0
for /f "delims=" %%V in ('node -p "require('./node_modules/electron/package.json').version"') do set EV=%%V
for /f "delims=" %%Z in ('dir /s /b "%LOCALAPPDATA%\electron\Cache\electron-v%EV%-win32-x64.zip" 2^>nul') do set ZIP=%%Z
if defined ZIP (
  mkdir node_modules\electron\dist 2>nul
  tar -xf "%ZIP%" -C node_modules\electron\dist
  echo electron.exe> node_modules\electron\path.txt
)
exit /b 0

:err
echo Setup failed. & pause & exit /b 1
