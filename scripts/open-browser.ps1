$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $env:FO_APP_URL
$startInfo.UseShellExecute = $true
$null = [System.Diagnostics.Process]::Start($startInfo)
