## Auto-Chain Downloader — Run Z18 → Z19 → Z20 unattended
## Usage: Open PowerShell, run:  .\download-chain.ps1

$zooms = @(19, 20)  # Z18 is already running — this chains the rest

Set-Location "C:\Projects\AxisCommand-TacticalSuite"

foreach ($z in $zooms) {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  Starting Zoom Level $z..." -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
    
    # Delete existing chunk if present (fresh download)
    $chunkFile = "chunks\tripoli-sat-Z$z.db"
    if (Test-Path $chunkFile) {
        Remove-Item $chunkFile -Force
        Write-Host "  Removed existing $chunkFile"
    }
    
    # Pipe 'y' to auto-confirm the download prompt
    echo y | node download-google-sat.js --zoom $z
    
    Write-Host ""
    Write-Host "  ✅ Zoom $z finished!" -ForegroundColor Green
    Write-Host ""
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  🎉 ALL ZOOM LEVELS COMPLETE!" -ForegroundColor Green
Write-Host "  Next: node merge-mbtiles.js" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
