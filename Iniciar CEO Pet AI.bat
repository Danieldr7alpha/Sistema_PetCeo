@echo off
setlocal
cd /d "%~dp0"
title CEO Pet AI - Inicializador

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-system.ps1"
if errorlevel 1 (
  echo.
  echo O CEO Pet AI nao conseguiu iniciar.
  echo Consulte os arquivos da pasta logs.
  echo.
  pause
  exit /b 1
)
exit /b 0
