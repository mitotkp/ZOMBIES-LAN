@echo off
setlocal
chcp 65001 >nul
title ZOMBIES LAN - Servidor
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Node.js. Instalalo desde https://nodejs.org ^(version 20 o superior^) y vuelve a intentarlo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\ws\package.json" goto install
if not exist "node_modules\three\package.json" goto install
goto run

:install
echo.
echo  Instalando dependencias por primera vez ^(npm install^)...
echo.
call npm install
if errorlevel 1 (
  echo.
  echo  No se pudieron instalar las dependencias. Revisa tu conexion a internet e intentalo de nuevo.
  echo.
  pause
  exit /b 1
)

:run
echo.
node server\index.js %*
if errorlevel 1 (
  echo.
  echo  El servidor se detuvo con un error. Lee el mensaje de arriba.
  echo.
  pause
  exit /b 1
)
endlocal
