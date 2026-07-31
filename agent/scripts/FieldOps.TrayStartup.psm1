Set-StrictMode -Version Latest
$script:StartupValueName = 'FieldOpsDashboardTray'
$script:StartupKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

function Register-FieldOpsTrayStartup {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$TrayPath)

    $resolved = (Resolve-Path -LiteralPath $TrayPath -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf) -or
        [IO.Path]::GetFileName($resolved) -ne 'FieldOps.Tray.exe') {
        throw "FieldOps tray executable was not found at '$TrayPath'."
    }

    New-Item -Path $script:StartupKey -Force | Out-Null
    $command = '"{0}"' -f $resolved
    New-ItemProperty -LiteralPath $script:StartupKey -Name $script:StartupValueName `
        -PropertyType String -Value $command -Force | Out-Null
    [pscustomobject]@{ ValueName = $script:StartupValueName; RegistryPath = $script:StartupKey; TrayPath = $resolved; Command = $command }
}

function Remove-FieldOpsTrayStartup {
    [CmdletBinding()]
    param()
    Remove-ItemProperty -LiteralPath $script:StartupKey -Name $script:StartupValueName -ErrorAction SilentlyContinue
}

Export-ModuleMember -Function Register-FieldOpsTrayStartup, Remove-FieldOpsTrayStartup
