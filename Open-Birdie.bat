@echo off
REM ============================================================
REM  Double-click this file to open Open-Birdie (desktop app).
REM  It launches the Electron app, which starts the local
REM  server and opens the game window automatically.
REM ============================================================
cd /d "%~dp0"
echo Starting Open-Birdie...
echo (A game window will open in a few seconds.)
echo.
call npm start
if errorlevel 1 (
  echo.
  echo -------------------------------------------------------
  echo  Open-Birdie did not start.
  echo  First-time setup? Install Node.js from https://nodejs.org
  echo  then, in this folder, run:  npm install
  echo -------------------------------------------------------
  pause
)
