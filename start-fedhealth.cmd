@echo off
REM Start FedHealth: AI model service (:8000), backend API (:4000) and website (:5173).
REM PostgreSQL runs as a Windows service and starts with the computer.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File tools\run-local.ps1 -Start -Frontend
if errorlevel 1 (
  echo.
  echo Start failed. See docs\RUN_GUIDE.md "If something goes wrong" and the logs in run-results\logs.
  if not defined FEDHEALTH_NO_PAUSE pause
  exit /b 1
)
if not defined FEDHEALTH_NO_BROWSER start "" http://localhost:5173
echo.
echo FedHealth is running at http://localhost:5173 . You can close this window; run stop-fedhealth.cmd to stop it.
if not defined FEDHEALTH_NO_PAUSE pause
