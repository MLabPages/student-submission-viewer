param(
    [switch]$Silent
)

$ErrorActionPreference = 'Stop'

$desktop = [Environment]::GetFolderPath('Desktop')
$nameBytes = [Convert]::FromBase64String('5o+Q5Ye654mp6YCj57aa56K66KqN44OE44O844Or')
$shortcutName = [Text.Encoding]::UTF8.GetString($nameBytes) + '.lnk'
$shortcutPath = Join-Path $desktop $shortcutName
$launcher = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$viewerScript = Join-Path $PSScriptRoot 'start-viewer.ps1'
$icon = Join-Path $PSScriptRoot 'assets\submission-viewer.ico'

if (-not (Test-Path -LiteralPath $viewerScript)) {
    throw "Viewer launcher not found: $viewerScript"
}

if (-not (Test-Path -LiteralPath $icon)) {
    throw "Viewer icon not found: $icon"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$viewerScript`""
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.IconLocation = "$icon,0"
$shortcut.Description = 'Review Word, PowerPoint, and PDF submissions.'
$shortcut.WindowStyle = 7
$shortcut.Save()

if (-not $Silent) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Desktop shortcut created successfully.`n$shortcutPath", 'Submission Viewer') | Out-Null
}
