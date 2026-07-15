param(
    [Parameter(Mandatory = $true)]
    [string]$PngPath,

    [Parameter(Mandatory = $true)]
    [string]$IcoPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
    param(
        [float]$X,
        [float]$Y,
        [float]$Width,
        [float]$Height,
        [float]$Radius
    )

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $Radius * 2
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

$directory = [System.IO.Path]::GetDirectoryName($PngPath)
[System.IO.Directory]::CreateDirectory($directory) | Out-Null

$bitmap = New-Object System.Drawing.Bitmap 256, 256, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

$backgroundPath = New-RoundedRectanglePath 14 14 228 228 48
$backgroundBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 28, 55, 82))
$graphics.FillPath($backgroundBrush, $backgroundPath)

$shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60, 0, 0, 0))
$sheetBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 247, 249, 252))
$backSheetBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 185, 204, 222))
$middleSheetBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 218, 229, 239))

$graphics.FillRectangle($shadowBrush, 64, 50, 126, 151)
$graphics.FillRectangle($backSheetBrush, 48, 40, 126, 151)
$graphics.FillRectangle($middleSheetBrush, 59, 50, 126, 151)
$graphics.FillRectangle($sheetBrush, 70, 60, 126, 151)

$blueBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 54, 112, 196))
$orangeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 225, 126, 48))
$redBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 199, 63, 73))
$graphics.FillRectangle($redBrush, 48, 40, 13, 45)
$graphics.FillRectangle($orangeBrush, 59, 50, 13, 45)
$graphics.FillRectangle($blueBrush, 70, 60, 13, 45)

$linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 137, 151, 168)), 8
$linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($linePen, 99, 95, 169, 95)
$graphics.DrawLine($linePen, 99, 122, 169, 122)
$graphics.DrawLine($linePen, 99, 149, 151, 149)

$checkBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 38, 151, 104))
$graphics.FillEllipse($checkBrush, 142, 143, 86, 86)
$checkPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 13
$checkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$checkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLines($checkPen, @(
    (New-Object System.Drawing.Point 161, 184),
    (New-Object System.Drawing.Point 178, 200),
    (New-Object System.Drawing.Point 209, 169)
))

$bitmap.Save($PngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$pngBytes = [System.IO.File]::ReadAllBytes($PngPath)
$stream = [System.IO.File]::Create($IcoPath)
$writer = New-Object System.IO.BinaryWriter $stream
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]1)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([uint16]1)
$writer.Write([uint16]32)
$writer.Write([uint32]$pngBytes.Length)
$writer.Write([uint32]22)
$writer.Write($pngBytes)
$writer.Dispose()

$checkPen.Dispose()
$checkBrush.Dispose()
$linePen.Dispose()
$redBrush.Dispose()
$orangeBrush.Dispose()
$blueBrush.Dispose()
$middleSheetBrush.Dispose()
$backSheetBrush.Dispose()
$sheetBrush.Dispose()
$shadowBrush.Dispose()
$backgroundBrush.Dispose()
$backgroundPath.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
