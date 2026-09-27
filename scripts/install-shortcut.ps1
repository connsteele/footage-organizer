$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe).Source
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'Footage Organizer.lnk'
$shellObject = New-Object -ComObject WScript.Shell
$shortcut = $shellObject.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'launch.ps1') + '" -NodePath "' + $nodePath + '"'
$shortcut.WindowStyle = 7
$shortcut.WorkingDirectory = $repoPath
$shortcut.Description = 'Open the local Footage Organizer'
$shortcut.IconLocation = (Join-Path $env:WINDIR 'System32\shell32.dll') + ',3'
$shortcut.Save()
Write-Output "Created $shortcutPath"
$stopShortcutPath = Join-Path $desktopPath 'Stop Footage Organizer.lnk'
$stopShortcut = $shellObject.CreateShortcut($stopShortcutPath)
$stopShortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$stopShortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'stop.ps1') + '"'
$stopShortcut.WorkingDirectory = $repoPath
$stopShortcut.WindowStyle = 7
$stopShortcut.Description = 'Stop the local Footage Organizer server'
$stopShortcut.IconLocation = (Join-Path $env:WINDIR 'System32\shell32.dll') + ',27'
$stopShortcut.Save()
Write-Output "Created $stopShortcutPath"
