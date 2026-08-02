$ErrorActionPreference = "Stop"

$envFile = Join-Path $PSScriptRoot "..\apps\api\.env"
if (-not (Test-Path $envFile)) {
  throw "Arquivo apps\api\.env nao encontrado. Crie a partir de apps\api\.env.example."
}

$databaseUrlLine = Get-Content $envFile | Where-Object { $_ -match "^DATABASE_URL=" } | Select-Object -First 1
if (-not $databaseUrlLine) {
  throw "DATABASE_URL nao encontrado em apps\api\.env."
}

$databaseUrl = $databaseUrlLine -replace "^DATABASE_URL=", ""
$databaseUrl = $databaseUrl.Trim('"')
$databaseUrl = $databaseUrl -replace "\?schema=public$", ""

$backupDir = Join-Path $PSScriptRoot "..\backups"
New-Item -ItemType Directory -Force $backupDir | Out-Null

$backupFile = Join-Path $backupDir ("ceo-pet-ai-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".sql")
pg_dump --dbname="$databaseUrl" -f "$backupFile"
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao gerar backup do banco."
}

Write-Host "Backup criado em $backupFile"
