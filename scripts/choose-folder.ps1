Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select the folder containing student submissions.'
$dialog.ShowNewFolderButton = $false

# The viewer server runs in the background.  Give the native picker a visible,
# topmost owner so Windows does not place it behind the browser or a console.
$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'Select submission folder'
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.ShowInTaskbar = $true
$owner.TopMost = $true
$owner.Opacity = 0.01

try {
    $owner.Show()
    $owner.Activate()
    $owner.BringToFront()
    if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
        Write-Output $dialog.SelectedPath
    }
} finally {
    $dialog.Dispose()
    $owner.Dispose()
}
