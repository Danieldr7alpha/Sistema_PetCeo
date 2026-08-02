@echo off
setlocal
cd /d "%~dp0"
title CEO Pet AI - Atualizacao do Banco

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-database.ps1"
if errorlevel 1 (
  echo.
  echo A atualizacao nao foi concluida. Nenhum reset foi executado.
  echo Consulte logs\database-update.log.
  echo.
  pause
  exit /b 1
)
echo.
pause
exit /b 0
