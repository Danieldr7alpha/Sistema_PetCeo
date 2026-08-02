$ErrorActionPreference = "Stop"
$projectPath = Split-Path -Parent $PSScriptRoot
$logsPath = Join-Path $projectPath "logs"
$apiLog = Join-Path $logsPath "api.log"
$webLog = Join-Path $logsPath "web.log"
$startupLog = Join-Path $logsPath "startup.log"

New-Item -ItemType Directory -Path $logsPath -Force | Out-Null

function Write-StartupMessage([string]$message) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host $message
  Add-Content -LiteralPath $startupLog -Value "[$timestamp] $message"
}

function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Get-ApiHealth {
  try {
    $body = & curl.exe --silent --max-time 2 "http://127.0.0.1:3333/health"
    if ($LASTEXITCODE -ne 0 -or -not $body) { return $null }
    return $body | ConvertFrom-Json
  } catch {
    return $null
  }
}

Set-Location $projectPath
Write-Host ""
Write-Host "=========================================="
Write-Host " CEO Pet AI"
Write-Host "=========================================="
Write-Host ""
Write-StartupMessage "Verificando o sistema..."

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-StartupMessage "Node.js nao foi encontrado. Instale o Node.js 20 ou superior."
  exit 1
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  Write-StartupMessage "npm nao foi encontrado. Reinstale o Node.js."
  exit 1
}

$apiEnv = Join-Path $projectPath "apps\api\.env"
$webEnv = Join-Path $projectPath "apps\web\.env"
if (-not (Test-Path -LiteralPath $apiEnv)) {
  Write-StartupMessage "Configuracao do banco nao encontrada em apps\api\.env."
  Write-StartupMessage "Copie apps\api\.env.example e configure DATABASE_URL."
  exit 1
}
if (-not (Select-String -LiteralPath $apiEnv -Pattern '^\s*DATABASE_URL\s*=\s*"?postgresql://' -Quiet)) {
  Write-StartupMessage "DATABASE_URL nao foi configurada corretamente em apps\api\.env."
  exit 1
}
if (-not (Test-Path -LiteralPath $webEnv)) {
  Copy-Item -LiteralPath (Join-Path $projectPath "apps\web\.env.example") -Destination $webEnv
  Write-StartupMessage "Configuracao da interface criada a partir do exemplo."
}

if (-not (Test-Path -LiteralPath (Join-Path $projectPath "node_modules"))) {
  Write-StartupMessage "Instalando dependencias pela primeira vez..."
  & npm.cmd install *> $startupLog
  if ($LASTEXITCODE -ne 0) {
    Write-StartupMessage "Nao foi possivel instalar as dependencias."
    exit 1
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $projectPath "node_modules\.prisma\client"))) {
  Write-StartupMessage "Gerando o Prisma Client local..."
  & npm.cmd run db:generate >> $startupLog 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-StartupMessage "Nao foi possivel gerar o Prisma Client. Consulte logs\startup.log."
    exit 1
  }
}

$apiRunning = Test-Port 3333
$webRunning = Test-Port 5173
if ($apiRunning -and $webRunning) {
  $health = Get-ApiHealth
  if ($health -and $health.status -eq "ok" -and $health.database -eq "connected") {
    Write-StartupMessage "O CEO Pet AI ja esta aberto."
    Start-Process "http://127.0.0.1:5173"
    exit 0
  }
}

if (-not $apiRunning) {
  Write-StartupMessage "Iniciando banco/API..."
  $apiProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/d", "/c", "npm run dev:api" -WorkingDirectory $projectPath -RedirectStandardOutput $apiLog -RedirectStandardError $apiLog.Replace(".log", "-error.log") -WindowStyle Hidden -PassThru
}
$deadline = (Get-Date).AddSeconds(25)
do {
  Start-Sleep -Milliseconds 500
  $apiRunning = Test-Port 3333
  $health = if ($apiRunning) { Get-ApiHealth } else { $null }
  if ($health -and $health.api -eq "running") { break }
} while ((Get-Date) -lt $deadline)

if (-not $apiRunning) {
  Write-StartupMessage "A API nao conseguiu iniciar. Consulte logs\api.log."
  exit 1
}
if (-not $health -or $health.database -ne "connected") {
  Write-StartupMessage "O CEO Pet AI nao conseguiu acessar o banco de dados."
  if (Select-String -LiteralPath $apiEnv -Pattern 'DATABASE_URL\s*=\s*"?postgresql://[^@]+@db\.[^/]+\.supabase\.co:5432' -Quiet) {
    Write-StartupMessage "O projeto Supabase configurado nao foi encontrado no DNS. Verifique a conexao do projeto no painel."
  } else {
    Write-StartupMessage "O servidor do Supabase nao foi alcancado ou recusou a conexao."
  }
  Write-StartupMessage "Consulte logs\api.log."
  Write-StartupMessage "Abrindo a interface em modo de recuperacao..."
  if (-not $webRunning) {
    $webProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/d", "/c", "npm run dev:web:launcher" -WorkingDirectory $projectPath -RedirectStandardOutput $webLog -RedirectStandardError $webLog.Replace(".log", "-error.log") -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds(25)
    do {
      Start-Sleep -Milliseconds 500
      $webRunning = Test-Port 5173
      if ($webRunning) { break }
    } while ((Get-Date) -lt $deadline)
  }
  if (-not $webRunning) {
    Write-StartupMessage "A interface nao conseguiu iniciar. Consulte logs\web.log."
    exit 1
  }
  Start-Process "http://127.0.0.1:5173"
  Write-StartupMessage "Interface aberta. Use Tentar novamente depois de corrigir a conexao do Supabase."
  exit 0
}

if (-not $webRunning) {
  Write-StartupMessage "Iniciando interface..."
  $webProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/d", "/c", "npm run dev:web:launcher" -WorkingDirectory $projectPath -RedirectStandardOutput $webLog -RedirectStandardError $webLog.Replace(".log", "-error.log") -WindowStyle Hidden -PassThru
}
$deadline = (Get-Date).AddSeconds(25)
do {
  Start-Sleep -Milliseconds 500
  $webRunning = Test-Port 5173
  if ($webRunning) { break }
} while ((Get-Date) -lt $deadline)
if (-not $webRunning) {
  Write-StartupMessage "A interface nao conseguiu iniciar. Consulte logs\web.log."
  exit 1
}

Write-StartupMessage "Abrindo CEO Pet AI..."
Start-Process "http://127.0.0.1:5173"
Write-StartupMessage "Sistema iniciado com sucesso. Nenhuma atualizacao de banco foi executada."
exit 0
