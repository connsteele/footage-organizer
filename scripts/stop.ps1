param([switch]$Quiet)
$ErrorActionPreference = 'Stop'

function Show-Result([string]$Message, [bool]$Failed = $false) {
  Write-Output $Message
  if (-not $Quiet) {
    $shellObject = New-Object -ComObject WScript.Shell
    $icon = if ($Failed) { 48 } else { 64 }
    $null = $shellObject.Popup($Message, 0, 'Footage Organizer', $icon)
  }
}

try {
  $repoPath = Split-Path -Parent $PSScriptRoot
  $configPath = Join-Path $repoPath 'organizer.local.json'
  $localConfig = if (Test-Path -LiteralPath $configPath) {
    Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  } else { $null }
  $appPort = if ($env:PORT) { [int]$env:PORT } elseif ($localConfig.port) { [int]$localConfig.port } else { 4317 }
  if ($appPort -lt 1 -or $appPort -gt 65535) { throw 'Invalid app port.' }
  $baseUrl = "http://127.0.0.1:$appPort"

  function Test-AppListening {
    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    return [bool]($listeners | Where-Object { $_.Port -eq $appPort -and $_.Address.ToString() -in @('127.0.0.1', '0.0.0.0', '::') } | Select-Object -First 1)
  }

  function Get-AppHealth {
    if (-not (Test-AppListening)) { return $null }
    try {
      Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 3
    } catch {
      if (-not (Test-AppListening)) { return $null }
      throw
    }
  }

  $health = Get-AppHealth
  if ($null -eq $health) {
    Show-Result 'Footage Organizer is already stopped.'
    exit 0
  }
  if ($health.app -ne 'footage-organizer') { throw "Port $appPort belongs to another program. Nothing was stopped." }
  $session = Invoke-RestMethod -Uri "$baseUrl/api/session" -TimeoutSec 3
  $null = Invoke-RestMethod -Uri "$baseUrl/api/shutdown" -Method Post -Headers @{ 'X-Organizer-Token' = $session.token } -TimeoutSec 5
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    $health = Get-AppHealth
    if ($null -eq $health -or $health.app -ne 'footage-organizer') {
      Show-Result 'Footage Organizer has stopped. You can close its browser tabs.'
      exit 0
    }
  }
  throw 'The app is still shutting down. Try again in a moment.'
} catch {
  $message = $_.Exception.Message
  if ($_.ErrorDetails.Message) {
    try {
      $problem = $_.ErrorDetails.Message | ConvertFrom-Json
      if ($problem.error) { $message = $problem.error }
    } catch { }
  }
  Show-Result "Could not stop Footage Organizer. $message" $true
  exit 1
}
