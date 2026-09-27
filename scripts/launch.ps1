param(
  [string]$NodePath,
  [switch]$NoOpen,
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'

try {
  $repoPath = Split-Path -Parent $PSScriptRoot
  if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw 'Node.js was not found. Install Node 22.12 or newer, then run npm run shortcut from the app folder.' }
    $NodePath = $nodeCommand.Source
  }
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $NodePath
  $startInfo.Arguments = '"' + (Join-Path $PSScriptRoot 'launch.mjs') + '"'
  if ($NoOpen) { $startInfo.Arguments += ' --no-open' }
  $startInfo.WorkingDirectory = $repoPath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $launcher = [System.Diagnostics.Process]::Start($startInfo)
  $outputTask = $launcher.StandardOutput.ReadToEndAsync()
  $errorTask = $launcher.StandardError.ReadToEndAsync()
  $launcher.WaitForExit()
  $outputText = $outputTask.GetAwaiter().GetResult().Trim()
  $errorText = $errorTask.GetAwaiter().GetResult().Trim()
  if ($launcher.ExitCode -ne 0) {
    if ($errorText) { throw $errorText }
    throw 'The app could not start. Run npm run launch from the app folder for details.'
  }
  if ($outputText) { Write-Output $outputText }
} catch {
  $message = "Footage Organizer could not open.`n`n" + $_.Exception.Message
  Write-Output $message
  if (-not $Quiet) {
    $shellObject = New-Object -ComObject WScript.Shell
    $null = $shellObject.Popup($message, 0, 'Footage Organizer', 48)
  }
  exit 1
} finally {
  if ($launcher) { $launcher.Dispose() }
}
