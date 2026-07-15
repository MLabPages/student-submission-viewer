param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

Start-Process -FilePath $Path
