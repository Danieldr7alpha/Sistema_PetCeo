$ErrorActionPreference = "Stop"
$projectPath = Split-Path -Parent $PSScriptRoot
$logsPath = Join-Path $projectPath "logs"
$updateLog = Join-Path $logsPath "database-update.log"
New-Item -ItemType Directory -Path $logsPath -Force | Out-Null
Set-Location $projectPath

function Write-UpdateMessage([string]$message) {
  Write-Host $message
  Add-Content -LiteralPath $updateLog -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message"
}

Write-UpdateMessage "Verificando a configuracao do banco..."
$apiEnv = Join-Path $projectPath "apps\api\.env"
if (-not (Test-Path -LiteralPath $apiEnv) -or -not (Select-String -LiteralPath $apiEnv -Pattern '^\s*DATABASE_URL\s*=\s*"?postgresql://' -Quiet)) {
  Write-UpdateMessage "Configuracao do Supabase nao encontrada."
  Write-UpdateMessage "Abra o Supabase, clique em Connect e copie a conexao Session Pooler para apps\api\.env."
  exit 1
}

$connectionResult = & node (Join-Path $PSScriptRoot "test-db-connection.mjs")
$connectionExitCode = $LASTEXITCODE
if ($connectionResult) {
  Add-Content -LiteralPath $updateLog -Value $connectionResult
}
if ($connectionExitCode -ne 0) {
  Write-UpdateMessage "Nao foi possivel conectar ao banco de dados."
  Write-UpdateMessage "Abra o Supabase, clique em Connect e copie a conexao Session Pooler para apps\api\.env."
  exit 1
}
Write-UpdateMessage "Conexao com o Supabase confirmada."

Write-UpdateMessage "Gerando o Prisma Client..."
& npm.cmd run db:generate >> $updateLog 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-UpdateMessage "Nao foi possivel gerar o Prisma Client."
  exit 1
}

Write-Host ""
Write-Host "A atualizacao do schema pode modificar a estrutura do banco."
$answer = Read-Host "Deseja executar prisma db push agora? Digite S para confirmar"
if ($answer -notmatch '^[sS]$') {
  Write-UpdateMessage "Atualizacao estrutural cancelada. Nenhuma alteracao foi aplicada."
  exit 0
}

Write-UpdateMessage "Atualizando a estrutura do banco..."
& npm.cmd run db:push >> $updateLog 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-UpdateMessage "Nao foi possivel atualizar o banco. Nenhum reset foi executado."
  exit 1
}
Write-UpdateMessage "Banco atualizado com sucesso."
exit 0
