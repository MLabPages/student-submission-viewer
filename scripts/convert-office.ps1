param(
    [Parameter(Mandatory = $true)]
    [string]$Source,

    [Parameter(Mandatory = $true)]
    [string]$Output
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$extension = [System.IO.Path]::GetExtension($Source).ToLowerInvariant()
$outputDirectory = [System.IO.Path]::GetDirectoryName($Output)
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

if ($extension -in @('.doc', '.docx')) {
    $word = $null
    $document = $null
    try {
        $word = New-Object -ComObject Word.Application
        $word.Visible = $false
        $word.DisplayAlerts = 0
        $word.AutomationSecurity = 3
        $document = $word.Documents.Open($Source, $false, $true, $false)
        $document.ExportAsFixedFormat($Output, 17)
    } finally {
        if ($document) {
            $document.Close($false)
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
        }
        if ($word) {
            $word.Quit()
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
        }
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
    exit 0
}

if ($extension -in @('.ppt', '.pptx')) {
    $powerPoint = $null
    $presentation = $null
    try {
        $powerPoint = New-Object -ComObject PowerPoint.Application
        $powerPoint.DisplayAlerts = 1
        $powerPoint.AutomationSecurity = 3
        $presentation = $powerPoint.Presentations.Open($Source, $true, $true, $false)
        $presentation.SaveAs($Output, 32)
    } finally {
        if ($presentation) {
            $presentation.Close()
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)
        }
        if ($powerPoint) {
            $powerPoint.Quit()
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint)
        }
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
    exit 0
}

throw "Unsupported file type: $extension"
