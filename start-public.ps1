# Démarre le site en production + un lien public Internet (trycloudflare.com)
# Usage : clic droit > "Exécuter avec PowerShell"  ou  .\start-public.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$logDir = Join-Path $env:TEMP "opencode"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# 1. Serveur Express sur le port 3000 (démarre seulement s'il n'est pas déjà lancé)
$listening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm start" -WorkingDirectory $root -WindowStyle Minimized
  Write-Host "Serveur en démarrage..." -ForegroundColor Cyan
  do { Start-Sleep -Seconds 2; $listening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue }
  while (-not $listening)
}
Write-Host "Serveur OK sur http://127.0.0.1:3000" -ForegroundColor Green

# 2. Tunnel cloudflared (ferme l'ancien tunnel s'il existe)
$old = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($old) { $old | Stop-Process -Force; Start-Sleep -Seconds 2 }

$cfLog = Join-Path $logDir "cloudflared.log"
$cfErr = Join-Path $logDir "cloudflared.err.log"
$cfExe = @("$env:ProgramFiles (x86)\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $cfExe) { winget install --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements --silent; $cfExe = "$env:ProgramFiles (x86)\cloudflared\cloudflared.exe" }

Start-Process -FilePath $cfExe -ArgumentList "tunnel", "--url", "http://127.0.0.1:3000", "--no-autoupdate" `
  -RedirectStandardOutput $cfLog -RedirectStandardError $cfErr -WindowStyle Hidden
Write-Host "Tunnel en cours de création..." -ForegroundColor Cyan

$url = $null
for ($i = 0; $i -lt 20 -and -not $url; $i++) {
  Start-Sleep -Seconds 2
  $url = (Select-String -Path $cfErr, $cfLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue |
    Select-Object -Last 1).Matches.Value
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Yellow
if ($url) {
  # Copie le lien dans le presse-papier + le sauvegarde dans LIEN-PUBLIC.txt
  Set-Clipboard -Value "$url/t/BUSA70A" -ErrorAction SilentlyContinue
  Set-Content -LiteralPath (Join-Path $root "LIEN-PUBLIC.txt") -Value "$url/t/BUSA70A" -Encoding UTF8
  Write-Host " LIEN PUBLIC À PARTAGER (copié dans le presse-papier ✅) :" -ForegroundColor Yellow
  Write-Host "   $url" -ForegroundColor White
  Write-Host ""
  Write-Host " Sauvegardé aussi dans : LIEN-PUBLIC.txt (racine du projet)" -ForegroundColor Gray
  Write-Host " Exemple classement : $url/t/BUSA70A" -ForegroundColor White
  Start-Process (Join-Path $root "LIEN-PUBLIC.txt")
} else {
  Write-Host " Échec de création du tunnel — voir $cfErr" -ForegroundColor Red
}
Write-Host "==============================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "⚠ Le lien reste actif tant que cette fenêtre/PC reste allumé." -ForegroundColor DarkGray
Read-Host "Appuyez sur Entrée pour fermer (le lien restera actif)"
