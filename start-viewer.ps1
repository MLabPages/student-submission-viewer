$ErrorActionPreference = 'Stop'
$dataDirectory = Join-Path $env:LOCALAPPDATA 'StudentSubmissionViewer'
$portFile = Join-Path $dataDirectory 'port.txt'
$stdoutLog = Join-Path $dataDirectory 'viewer.out.log'
$stderrLog = Join-Path $dataDirectory 'viewer.error.log'
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null

function Test-Viewer([int]$Port) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1
        if ($response.StatusCode -eq 200) {
            $health = $response.Content | ConvertFrom-Json
            return $health.app -eq 'student-submission-viewer'
        }
    } catch {
        return $false
    }
    return $false
}

if (Test-Path -LiteralPath $portFile) {
    $savedPort = [int](Get-Content -LiteralPath $portFile -Raw)
    if (Test-Viewer $savedPort) {
        Start-Process "http://127.0.0.1:$savedPort"
        exit 0
    }
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('Node.js was not found. Please ask Codex to check the setup.', 'Submission Viewer') | Out-Null
    exit 1
}

$usedPorts = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port
$port = 3210..3220 | Where-Object { $_ -notin $usedPorts } | Select-Object -First 1
if (-not $port) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('No local port is available. Please ask Codex to check the setup.', 'Submission Viewer') | Out-Null
    exit 1
}

$env:PORT = [string]$port
Start-Process -FilePath $node.Source `
    -ArgumentList @((Join-Path $PSScriptRoot 'server.js')) `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog

for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 200
    if (Test-Viewer $port) {
        Start-Process "http://127.0.0.1:$port"
        exit 0
    }
}

Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show("The viewer could not start. Error log: $stderrLog", 'Submission Viewer') | Out-Null
exit 1
