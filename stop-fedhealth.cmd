@echo off
REM Stop the FedHealth services started by start-fedhealth.cmd (PostgreSQL keeps running).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File tools\run-local.ps1 -Stop
if not defined FEDHEALTH_NO_PAUSE pause
