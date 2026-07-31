[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'FieldOps.TrayStartup.psm1') -Force

$serviceName = 'FieldOpsAgent'
$installPath = [IO.Path]::GetFullPath((Join-Path $env:ProgramFiles 'FieldOpsDashboard\Agent')).TrimEnd('\')
$trayInstallPath = [IO.Path]::GetFullPath((Join-Path $env:ProgramFiles 'FieldOpsDashboard\Tray')).TrimEnd('\')
$dataPath = [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'FieldOpsDashboard\Agent')).TrimEnd('\')

function Assert-SafeRemovalPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedRoot
    )

    $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $fullRoot = [IO.Path]::GetFullPath($ExpectedRoot).TrimEnd('\')
    $requiredPrefix = $fullRoot + '\'
    if (-not $fullPath.StartsWith($requiredPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        $fullPath -eq $fullRoot -or
        [IO.Path]::GetPathRoot($fullPath).TrimEnd('\') -eq $fullPath) {
        throw "Refusing unsafe removal path '$fullPath'."
    }

    if (Test-Path -LiteralPath $fullPath) {
        $item = Get-Item -LiteralPath $fullPath -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing to remove reparse point '$fullPath'."
        }
    }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Uninstall-FieldOpsAgent.ps1 must be run from an elevated PowerShell session.'
}

Assert-SafeRemovalPath -Path $installPath -ExpectedRoot (Join-Path $env:ProgramFiles 'FieldOpsDashboard')
Assert-SafeRemovalPath -Path $trayInstallPath -ExpectedRoot (Join-Path $env:ProgramFiles 'FieldOpsDashboard')
Assert-SafeRemovalPath -Path $dataPath -ExpectedRoot (Join-Path $env:ProgramData 'FieldOpsDashboard')

Remove-FieldOpsTrayStartup

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped) {
        Stop-Service -Name $serviceName
        $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
    }

    & sc.exe delete $serviceName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to remove service '$serviceName'."
    }
}

foreach ($path in @($installPath, $trayInstallPath, $dataPath)) {
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Recurse -Force
    }
}

if ([Diagnostics.EventLog]::SourceExists($serviceName)) {
    Remove-EventLog -Source $serviceName
}

Write-Host 'FieldOps Local Agent and its protected credential were removed.'
