<#
.SYNOPSIS
  Run FedHealth locally without Docker: PostgreSQL (already running as a
  Windows service), the Flask inference service with the seed-42 bundle, the
  Node backend, and optionally the Vite frontend.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\run-local.ps1 -Setup     # migrate, register model, import runs
  powershell -ExecutionPolicy Bypass -File tools\run-local.ps1 -Start     # inference :8000 + backend :4000
  powershell -ExecutionPolicy Bypass -File tools\run-local.ps1 -Start -Frontend   # + Vite :5173 (real API; add -Mock for the demo mock)
  powershell -ExecutionPolicy Bypass -File tools\run-local.ps1 -Status
  powershell -ExecutionPolicy Bypass -File tools\run-local.ps1 -Stop

  Needs: .venv (pip install -r requirements-test.txt), Node 18+, the git-ignored
  "Module 1-2 Merged Backend\.env" and, for -Setup, the git-ignored root .env
  with PG_SUPERUSER_PASSWORD. Logs and PIDs go to run-results\ (git-ignored).
#>
param([switch]$Setup, [switch]$Start, [switch]$Frontend, [switch]$Mock, [switch]$Status, [switch]$Stop)
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root 'Module 1-2 Merged Backend'
$Python = Join-Path $Root '.venv\Scripts\python.exe'
$Bundle = Join-Path $Root 'FYP_model_data_drive\FYP\four_class\four_class_v1\seed42\centralized\model'
# Fallback model: an independently trained bundle (seed 52) for the same four-class contract.
# The primary service keeps it loaded in process, and a second service on :8001 serves it alone,
# so neither a broken primary bundle nor a dead primary process stops predictions.
$BackupBundle = Join-Path $Root 'FYP_model_data_drive\FYP\four_class\four_class_v1\seed52\centralized\model'
$SpeechPython = Join-Path $Root '.venv-speech\Scripts\python.exe'
$Runs = Join-Path $Root 'FYP_model_data_drive\FYP\four_class\four_class_v1'
$Paillier = Join-Path $Root 'docs\evidence\paillier_seed42_iid_r5'
$Logs = Join-Path $Root 'run-results\logs'
$PidFile = Join-Path $Root 'run-results\local-pids.json'
New-Item -ItemType Directory -Force $Logs | Out-Null

function Read-EnvValue([string]$File, [string]$Name) {
  foreach ($line in Get-Content $File) {
    if ($line -match "^$Name=(.*)$") { return $Matches[1] }
  }
  return $null
}

function Test-Url([string]$Url) {
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $Url).StatusCode -eq 200 } catch { $false }
}

function Wait-Url([string]$Url, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Url $Url) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

if (-not (Test-Path (Join-Path $Backend '.env'))) { throw 'Missing "Module 1-2 Merged Backend\.env" (see .env.example).' }

if ($Setup) {
  Push-Location $Backend
  try {
    node scripts/db-setup.js; if ($LASTEXITCODE) { throw 'db-setup failed' }
    node scripts/register-model.js; if ($LASTEXITCODE) { throw 'register-model failed' }
    if (Test-Path $BackupBundle) {
      node scripts/register-model.js --bundle $BackupBundle --metrics (Join-Path $Runs 'final_test\seed52_centralized_metrics.json') --no-activate
      if ($LASTEXITCODE) { throw 'backup model registration failed' }
    }
    node scripts/migrate-patient-refs.js --apply; if ($LASTEXITCODE) { throw 'patient reference migration failed' }
    node scripts/import-fl-history.js --all $Runs; if ($LASTEXITCODE) { throw 'FL import failed' }
    if (Test-Path (Join-Path $Paillier 'round_history.json')) {
      node scripts/import-fl-history.js $Paillier --scenario iid --base-model $Bundle --completed-at 2026-09-26T15:08:14+05:00
      if ($LASTEXITCODE) { throw 'Paillier run import failed' }
    }
    node scripts/seed-help-portal.js; if ($LASTEXITCODE) { throw 'Help Portal sample data failed' }
  } finally { Pop-Location }
}

function Read-Pids {
  $h = @{}
  if (Test-Path $PidFile) {
    $saved = Get-Content $PidFile | ConvertFrom-Json
    foreach ($name in $saved.PSObject.Properties.Name) { $h[$name] = $saved.$name }
  }
  return $h
}

if ($Start) {
  if (-not (Test-Path $Python)) { throw 'Missing .venv; create it with Python 3.12 and requirements-test.txt.' }
  $pids = Read-Pids
  if (Test-Url 'http://127.0.0.1:8000/health') {
    Write-Host 'inference already running on :8000'
  } else {
    $env:FEDHEALTH_MODEL_DIR = $Bundle
    if (Test-Path $BackupBundle) { $env:FEDHEALTH_BACKUP_MODEL_DIR = $BackupBundle }
    $env:FEDHEALTH_REPLICA_ROLE = 'primary'
    $env:HOST = '127.0.0.1'
    $env:PORT = '8000'
    $env:TF_CPP_MIN_LOG_LEVEL = '2'
    $env:INFERENCE_API_KEY = Read-EnvValue (Join-Path $Backend '.env') 'INFERENCE_API_KEY'
    $p = Start-Process -PassThru -WindowStyle Hidden -FilePath $Python `
      -ArgumentList "`"$(Join-Path $Root 'Module 6 Domain API\app.py')`"" -WorkingDirectory $Root `
      -RedirectStandardOutput (Join-Path $Logs 'inference.out.log') -RedirectStandardError (Join-Path $Logs 'inference.log')
    Remove-Item Env:PORT, Env:HOST, Env:INFERENCE_API_KEY
    $pids.inference = $p.Id
    if (-not (Wait-Url 'http://127.0.0.1:8000/health' 90)) { throw 'inference did not become healthy; see run-results\logs\inference.log' }
    Write-Host "inference :8000 (pid $($p.Id))"
  }
  Remove-Item Env:FEDHEALTH_BACKUP_MODEL_DIR -ErrorAction SilentlyContinue
  # Backup replica: a second inference process serving only the backup bundle.
  if (-not (Test-Path $BackupBundle)) {
    Write-Host 'backup bundle not found; running without a backup replica'
  } elseif (Test-Url 'http://127.0.0.1:8001/health') {
    Write-Host 'backup inference already running on :8001'
  } else {
    $env:FEDHEALTH_MODEL_DIR = $BackupBundle
    $env:FEDHEALTH_REPLICA_ROLE = 'backup'
    $env:HOST = '127.0.0.1'
    $env:PORT = '8001'
    $env:TF_CPP_MIN_LOG_LEVEL = '2'
    $env:INFERENCE_API_KEY = Read-EnvValue (Join-Path $Backend '.env') 'INFERENCE_API_KEY'
    $p = Start-Process -PassThru -WindowStyle Hidden -FilePath $Python `
      -ArgumentList "`"$(Join-Path $Root 'Module 6 Domain API\app.py')`"" -WorkingDirectory $Root `
      -RedirectStandardOutput (Join-Path $Logs 'inference-backup.out.log') -RedirectStandardError (Join-Path $Logs 'inference-backup.log')
    Remove-Item Env:PORT, Env:HOST, Env:INFERENCE_API_KEY, Env:FEDHEALTH_REPLICA_ROLE, Env:FEDHEALTH_MODEL_DIR
    $pids.inferenceBackup = $p.Id
    if (-not (Wait-Url 'http://127.0.0.1:8001/health' 90)) { throw 'backup inference did not become healthy; see run-results\logs\inference-backup.log' }
    Write-Host "backup inference :8001 (pid $($p.Id))"
  }
  # Speech-to-text (Whisper) for symptom dictation. Optional: without it the
  # doctor portal falls back to the browser's own speech recognition.
  if (-not (Test-Path $SpeechPython)) {
    Write-Host 'speech: .venv-speech not found (python -m venv .venv-speech; pip install -r requirements-speech.txt); dictation uses the browser fallback'
  } elseif (Test-Url 'http://127.0.0.1:8002/health') {
    Write-Host 'speech already running on :8002'
  } else {
    $env:INFERENCE_API_KEY = Read-EnvValue (Join-Path $Backend '.env') 'INFERENCE_API_KEY'
    $p = Start-Process -PassThru -WindowStyle Hidden -FilePath $SpeechPython `
      -ArgumentList "`"$(Join-Path $Root 'Module 6 Domain API\speech_service.py')`"" -WorkingDirectory $Root `
      -RedirectStandardOutput (Join-Path $Logs 'speech.out.log') -RedirectStandardError (Join-Path $Logs 'speech.log')
    Remove-Item Env:INFERENCE_API_KEY
    $pids.speech = $p.Id
    if (Wait-Url 'http://127.0.0.1:8002/health' 30) { Write-Host "speech :8002 (pid $($p.Id))" }
    else { Write-Host 'speech did not start (see run-results\logs\speech.log); dictation uses the browser fallback' }
  }
  if (Test-Url 'http://127.0.0.1:4000/health') {
    Write-Host 'backend already running on :4000'
  } else {
    $p = Start-Process -PassThru -WindowStyle Hidden -FilePath node -ArgumentList 'src/bootstrap.js' `
      -WorkingDirectory $Backend -RedirectStandardOutput (Join-Path $Logs 'backend.log') `
      -RedirectStandardError (Join-Path $Logs 'backend.err.log')
    $pids.backend = $p.Id
    if (-not (Wait-Url 'http://127.0.0.1:4000/health' 30)) { throw 'backend did not start; see run-results\logs\backend*.log' }
    Write-Host "backend :4000 (pid $($p.Id))"
  }
  if ($Frontend) {
    if (Test-Url 'http://localhost:5173') {
      Write-Host 'frontend already running on :5173'
    } else {
      # Real client against the backend, even if frontend\.env.local sets VITE_USE_MOCK=true
      # (process environment overrides Vite .env files). Use -Mock for the demo mock instead.
      $env:VITE_USE_MOCK = $(if ($Mock) { 'true' } else { 'false' })
      $p = Start-Process -PassThru -WindowStyle Hidden -FilePath npm.cmd -ArgumentList 'run', 'dev' `
        -WorkingDirectory (Join-Path $Root 'frontend') -RedirectStandardOutput (Join-Path $Logs 'frontend.log') `
        -RedirectStandardError (Join-Path $Logs 'frontend.err.log')
      $pids.frontend = $p.Id
      if (-not (Wait-Url 'http://localhost:5173' 60)) { throw 'frontend did not start; see run-results\logs\frontend*.log' }
      Write-Host "frontend :5173 (pid $($p.Id)); VITE_USE_MOCK=$env:VITE_USE_MOCK; open http://localhost:5173"
    }
  }
  if ($pids.Count) { $pids | ConvertTo-Json | Set-Content -Encoding utf8 $PidFile }
}

if ($Status -or $Start) {
  foreach ($u in 'http://127.0.0.1:8000/health', 'http://127.0.0.1:8001/health', 'http://127.0.0.1:8002/health', 'http://127.0.0.1:4000/health', 'http://127.0.0.1:4000/health/inference', 'http://localhost:5173') {
    Write-Host ("{0,-42} {1}" -f $u, $(if (Test-Url $u) { 'up' } else { 'down' }))
  }
}

# Kill a process and its children. Never throws: under $ErrorActionPreference = 'Stop',
# Windows PowerShell turns taskkill's stderr ("process not found") into a terminating
# error, which used to abort -Stop before the remaining services were stopped.
function Stop-Tree([int]$Id) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & taskkill.exe /PID $Id /T /F 2>$null | Out-Null } catch { } finally { $ErrorActionPreference = $previous }
}

if ($Stop) {
  # Kill each started process with its children (npm -> vite, etc.). A recorded PID
  # may be stale (the service was restarted by hand) or reused by an unrelated
  # program, so only a live node/python/npm process is stopped.
  $pids = Read-Pids
  foreach ($name in $pids.Keys) {
    $proc = Get-Process -Id $pids[$name] -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -match '^(node|python|npm|cmd)') {
      Stop-Tree $pids[$name]
      Write-Host "stopped $name"
    } else {
      Write-Host "$name was not running (recorded pid $($pids[$name]))"
    }
  }
  if (Test-Path $PidFile) { Remove-Item $PidFile }
  # Fallback: anything still listening on our ports that is node/python (e.g. PID file lost).
  foreach ($port in 8000, 8001, 8002, 4000, 5173) {
    $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($id in $owners) {
      $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($proc -and $proc.ProcessName -match '^(node|python)') {
        Stop-Tree $id
        Write-Host "stopped $($proc.ProcessName) on :$port"
      }
    }
  }
}
