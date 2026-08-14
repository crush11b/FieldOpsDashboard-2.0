[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'FieldOps.TrayStartup.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'FieldOps.OperatorProvisioning.psm1') -Force

$serviceName = 'FieldOpsAgent'
$installPath = [IO.Path]::GetFullPath((Join-Path $env:ProgramFiles 'FieldOpsDashboard\Agent')).TrimEnd('\')
$trayInstallPath = [IO.Path]::GetFullPath((Join-Path $env:ProgramFiles 'FieldOpsDashboard\Tray')).TrimEnd('\')
$dataPath = [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'FieldOpsDashboard\Agent')).TrimEnd('\')
$operatorStatePath = Join-Path $dataPath 'operator-provisioning.json'
$operatorState = Read-FieldOpsOperatorProvisioningState -StatePath $operatorStatePath
if ($null -eq $operatorState) {
    throw "FieldOps operator ownership state is required to remove the enrolled operator's startup registration."
}

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

Remove-FieldOpsTrayStartup -OperatorSid ([string]$operatorState.enrolledAccountSid)

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped) {
        Stop-Service -Name $serviceName
        $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
    }

    Remove-FieldOpsOperatorServiceEnvironment -ServiceName $serviceName
    & sc.exe delete $serviceName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to remove service '$serviceName'."
    }
}

try {
    $operatorStateRemoved = Remove-FieldOpsOperatorProvisioning -StatePath $operatorStatePath
} catch {
    $operatorStateRemoved = $false
    Write-Warning "Operator provisioning cleanup was not safe: $($_.Exception.Message) Group, membership, and ownership state are being preserved."
}

foreach ($path in @($installPath, $trayInstallPath)) {
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Recurse -Force
    }
}
if (Test-Path -LiteralPath $dataPath) {
    $knownDataFiles = @(
        (Join-Path $dataPath 'health-token.dat'),
        $operatorStatePath
    )
    foreach ($knownDataFile in $knownDataFiles) {
        if ((Test-Path -LiteralPath $knownDataFile -PathType Leaf) -and
            ($operatorStateRemoved -or $knownDataFile -ne $operatorStatePath)) {
            Remove-Item -LiteralPath $knownDataFile -Force
        }
    }
    if (@(Get-ChildItem -LiteralPath $dataPath -Force).Count -eq 0) {
        Remove-Item -LiteralPath $dataPath -Force
    } elseif (Test-Path -LiteralPath $operatorStatePath -PathType Leaf) {
        Write-Warning "Preserved operator ownership state at '$operatorStatePath' because group ownership could not be proven."
    } else {
        Write-Warning "Preserved unrelated files under '$dataPath'."
    }
}

if ([Diagnostics.EventLog]::SourceExists($serviceName)) {
    Remove-EventLog -Source $serviceName
}

Write-Host 'FieldOps Local Agent and its protected credential were removed.'
