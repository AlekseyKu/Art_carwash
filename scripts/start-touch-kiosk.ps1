# Тестовый запуск кассы на сенсорном ПК без Electron:
# поднимает local-api (UI + API на :3001) и открывает Edge/Chrome в kiosk.
# Требуется Node.js >= 20 и pnpm.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Port = if ($env:ART_PORT) { $env:ART_PORT } else { "3001" }
$DataDir = Join-Path $env:LOCALAPPDATA "ArtCarwash\data"
$WebDist = Join-Path $Root "apps\web\dist"

Write-Host "== Автомойка АРТ · touch kiosk ==" -ForegroundColor Cyan

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Error "pnpm не найден. Установите: npm i -g pnpm"
}

if (-not (Test-Path (Join-Path $WebDist "index.html"))) {
  Write-Host "Сборка web..."
  pnpm --filter @art/shared build
  pnpm --filter @art/web build
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$env:PORT = $Port
$env:ART_DATA_DIR = $DataDir
$env:ART_WEB_DIST = $WebDist

Write-Host "API+UI: http://127.0.0.1:$Port  (данные: $DataDir)"
$api = Start-Process -FilePath "pnpm" -ArgumentList "--filter","@art/local-api","exec","tsx","src/index.ts" `
  -WorkingDirectory (Join-Path $Root "services\local-api") `
  -PassThru -WindowStyle Minimized

Start-Sleep -Seconds 2

$url = "http://127.0.0.1:$Port/"
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" }
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"

$browser = $null
if (Test-Path $edge) { $browser = $edge }
elseif (Test-Path $chrome) { $browser = $chrome }
else { Write-Error "Не найден Edge/Chrome для kiosk-режима" }

Write-Host "Kiosk: $browser"
$browserArgs = @(
  "--kiosk", $url,
  "--edge-kiosk-type=fullscreen",
  "--no-first-run",
  "--disable-features=TranslateUI",
  "--check-for-update-interval=31536000"
)

$ui = Start-Process -FilePath $browser -ArgumentList $browserArgs -PassThru

Write-Host "Выход: закройте окно браузера (Alt+F4). API остановится следом."
Wait-Process -Id $ui.Id
if (-not $api.HasExited) { Stop-Process -Id $api.Id -Force }
