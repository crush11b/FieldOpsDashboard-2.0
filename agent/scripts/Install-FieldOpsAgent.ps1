[CmdletBinding()]
param(
    [string]$PublishPath,
    [string]$TrayPublishPath,
    [Parameter(Mandatory = $true)][string]$OperatorAccount
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$scriptPath = $MyInvocation.MyCommand.Path
$scriptDirectory = if (-not [string]::IsNullOrWhiteSpace($scriptPath)) { Split-Path -Parent $scriptPath } else { $PSScriptRoot }
if ([string]::IsNullOrWhiteSpace($scriptDirectory)) { throw 'Could not resolve the installer script directory.' }
if ([string]::IsNullOrWhiteSpace($PublishPath)) { $PublishPath = Join-Path $scriptDirectory '..\artifacts\publish\win-x64\agent' }
if ([string]::IsNullOrWhiteSpace($TrayPublishPath)) { $TrayPublishPath = Join-Path $scriptDirectory '..\artifacts\publish\win-x64\tray' }
foreach ($required in @((Join-Path $PublishPath 'FieldOps.Agent.exe'), (Join-Path $TrayPublishPath 'FieldOps.Tray.exe'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Native publish layout is missing '$required'." }
}
Add-Type -AssemblyName System.Security
Import-Module (Join-Path $scriptDirectory 'FieldOps.TrayStartup.psm1') -Force
Import-Module (Join-Path $scriptDirectory 'FieldOps.OperatorProvisioning.psm1') -Force

$serviceName = 'FieldOpsAgent'
$executableName = 'FieldOps.Agent.exe'
$installPath = Join-Path $env:ProgramFiles 'FieldOpsDashboard\Agent'
$trayInstallPath = Join-Path $env:ProgramFiles 'FieldOpsDashboard\Tray'
$dataPath = Join-Path $env:ProgramData 'FieldOpsDashboard\Agent'
$operatorStatePath = Join-Path $dataPath 'operator-provisioning.json'

function Invoke-ServiceControl {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    & sc.exe @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "sc.exe $($Arguments[0]) failed with exit code $LASTEXITCODE."
    }
}

function Set-FieldOpsAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][bool]$IsDirectory
    )

    $inheritance = if ($IsDirectory) { '(OI)(CI)' } else { '' }
    & icacls.exe $Path /inheritance:r /grant:r "*S-1-5-18:$inheritance(F)" "*S-1-5-32-544:$inheritance(F)" "*S-1-5-19:$inheritance(R)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls ACL application failed for '$Path' (exit code $LASTEXITCODE)." }
}

function Assert-FieldOpsAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) {
        throw "ACL inheritance remains enabled on '$Path'."
    }

    $allowedSids = @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-19')
    $rules = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
    foreach ($rule in $rules) {
        if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            $allowedSids -notcontains $rule.IdentityReference.Value) {
            throw "Unexpected ACL entry on '$Path': $($rule.IdentityReference.Value)."
        }
    }

    foreach ($sid in $allowedSids) {
        $matchingRules = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid })
        if ($matchingRules.Count -ne 1) {
            throw "Required ACL entry '$sid' is missing from '$Path'."
        }
    }

    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $rule = $rules | Where-Object { $_.IdentityReference.Value -eq $sid }
        if (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne
            [Security.AccessControl.FileSystemRights]::FullControl) {
            throw "ACL entry '$sid' does not have full control on '$Path'."
        }
    }

    $localServiceRule = $rules | Where-Object { $_.IdentityReference.Value -eq 'S-1-5-19' }
    if (($localServiceRule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadAndExecute) -ne
        [Security.AccessControl.FileSystemRights]::ReadAndExecute) {
        throw "LocalService cannot read '$Path'."
    }

    $forbiddenLocalServiceRights =
        [Security.AccessControl.FileSystemRights]::WriteData -bor
        [Security.AccessControl.FileSystemRights]::AppendData -bor
        [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership
    if (($localServiceRule.FileSystemRights -band $forbiddenLocalServiceRights) -ne 0) {
        throw "LocalService has excessive rights on '$Path'."
    }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Install-FieldOpsAgent.ps1 must be run from an elevated PowerShell session.'
}

$resolvedPublishPath = (Resolve-Path -LiteralPath $PublishPath).Path
$resolvedTrayPublishPath = (Resolve-Path -LiteralPath $TrayPublishPath).Path
$sourceExecutable = Join-Path $resolvedPublishPath $executableName
$sourceTrayExecutable = Join-Path $resolvedTrayPublishPath 'FieldOps.Tray.exe'
if (-not (Test-Path -LiteralPath $sourceExecutable -PathType Leaf)) {
    throw "Published agent executable was not found at '$sourceExecutable'."
}
if (-not (Test-Path -LiteralPath $sourceTrayExecutable -PathType Leaf)) {
    throw "Published tray executable was not found at '$sourceTrayExecutable'."
}

$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
$upgrade = $null -ne $existingService
if ($upgrade) {
    Stop-Service -Name $serviceName -Force -ErrorAction Stop
    $existingService.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
}

if (-not $upgrade -and ((Test-Path -LiteralPath $installPath) -or (Test-Path -LiteralPath $dataPath))) {
    throw 'Existing FieldOps Agent files were found. Run the uninstaller before reinstalling.'
}
if (-not $upgrade -and (Test-Path -LiteralPath $trayInstallPath)) {
    throw 'Existing FieldOps tray files were found. Run the uninstaller before reinstalling.'
}

$installCreated = $false
$trayInstallCreated = $false
$dataCreated = $false
$eventSourceCreated = $false
$serviceCreated = $false
$serviceCreateAttempted = $false
$credentialTempPath = $null
$trayStartupRegistered = $false
$operatorProvisioning = $null
$operatorEnvironmentConfigured = $false
$operatorEnvironmentSnapshot = $null

try {
    New-Item -ItemType Directory -Path $installPath -Force | Out-Null
    $installCreated = -not $upgrade
    New-Item -ItemType Directory -Path $trayInstallPath -Force | Out-Null
    $trayInstallCreated = -not $upgrade
    New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
    $dataCreated = -not $upgrade
    Set-FieldOpsAcl -Path $dataPath -IsDirectory $true
    Assert-FieldOpsAcl -Path $dataPath
    $operatorProvisioning = New-FieldOpsOperatorProvisioning `
        -OperatorAccount $OperatorAccount `
        -StatePath $operatorStatePath
    Copy-Item -Path (Join-Path $resolvedPublishPath '*') -Destination $installPath -Recurse -Force
    Copy-Item -Path (Join-Path $resolvedTrayPublishPath '*') -Destination $trayInstallPath -Recurse -Force
    Register-FieldOpsTrayStartup -TrayPath (Join-Path $trayInstallPath 'FieldOps.Tray.exe') | Out-Null
    $trayStartupRegistered = $true

    $credentialPath = Join-Path $dataPath 'health-token.dat'
    if ($upgrade -and (Test-Path $credentialPath)) { $protectedToken = $null } else {
    $tokenBytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($tokenBytes)
    } finally {
        $random.Dispose()
    }

    $token = [Convert]::ToBase64String($tokenBytes)
    [Array]::Clear($tokenBytes, 0, $tokenBytes.Length)
    $tokenPlaintext = [Text.Encoding]::UTF8.GetBytes($token)
    try {
        $protectedToken = [Security.Cryptography.ProtectedData]::Protect(
            $tokenPlaintext,
            $null,
            [Security.Cryptography.DataProtectionScope]::LocalMachine)
    } finally {
        [Array]::Clear($tokenPlaintext, 0, $tokenPlaintext.Length)
        $token = $null
    }

    $credentialTempPath = Join-Path $dataPath ('.health-token-{0}.tmp' -f [Guid]::NewGuid().ToString('N'))
    try {
        [IO.File]::WriteAllBytes($credentialTempPath, $protectedToken)
        Set-FieldOpsAcl -Path $credentialTempPath -IsDirectory $false
        Assert-FieldOpsAcl -Path $credentialTempPath
        Move-Item -LiteralPath $credentialTempPath -Destination $credentialPath
        $credentialTempPath = $null
        Assert-FieldOpsAcl -Path $credentialPath
    } finally {
        [Array]::Clear($protectedToken, 0, $protectedToken.Length)
    }
    }

    if (-not [Diagnostics.EventLog]::SourceExists($serviceName)) {
        New-EventLog -LogName Application -Source $serviceName
        $eventSourceCreated = $true
    }

    $installedExecutable = Join-Path $installPath $executableName
    $binaryPath = '"{0}"' -f $installedExecutable
    if (-not $upgrade) {
    $serviceCreateAttempted = $true
    Invoke-ServiceControl -Arguments @(
        'create',
        $serviceName,
        'binPath=', $binaryPath,
        'start=', 'auto',
        'obj=', 'NT AUTHORITY\LocalService',
        'DisplayName=', 'FieldOps Local Agent'
    )
    $serviceCreated = $true
    }
    if (-not $upgrade) { Invoke-ServiceControl -Arguments @('description', $serviceName, 'Trusted local service boundary for FieldOps Dashboard.') }
    if (-not $upgrade) { Invoke-ServiceControl -Arguments @(
        'failure',
        $serviceName,
        'reset=', '86400',
        'actions=', 'restart/5000/restart/15000/restart/30000'
    ) }

    $operatorEnvironmentSnapshot = Get-FieldOpsServiceEnvironment -ServiceName $serviceName
    Set-FieldOpsOperatorServiceEnvironment -ServiceName $serviceName `
        -GroupSid $operatorProvisioning.GroupSid
    $operatorEnvironmentConfigured = $true

    Start-Service -Name $serviceName
    $service = Get-Service -Name $serviceName
    $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(30))

    $operation = if ($upgrade) { 'upgraded' } else { 'installed' }
    Write-Host "FieldOps Local Agent $operation and running from '$installPath'."
    Write-Host "FieldOps tray startup registered for the current user at '$trayInstallPath\FieldOps.Tray.exe'."
    Write-Host "The configured operator must sign out and sign in before native-health access if group membership was newly added."
} catch {
    $failure = $_
    $rollbackFailures = @()
    if ($operatorEnvironmentConfigured -and $operatorEnvironmentSnapshot) {
        try {
            Restore-FieldOpsServiceEnvironment -ServiceName $serviceName `
                -Exists $operatorEnvironmentSnapshot.Exists `
                -Entries $operatorEnvironmentSnapshot.Entries
        } catch { $rollbackFailures += "Could not restore native-health operator service configuration: $($_.Exception.Message)" }
    }
    if ($operatorProvisioning) {
        try { Undo-FieldOpsOperatorProvisioningAttempt -Provisioning $operatorProvisioning } catch { $rollbackFailures += "Could not roll back operator provisioning: $($_.Exception.Message)" }
    }
    if ($trayStartupRegistered) {
        try { Remove-FieldOpsTrayStartup } catch { $rollbackFailures += "Could not remove tray startup registration: $($_.Exception.Message)" }
    }
    if ($serviceCreateAttempted) {
        $rollbackService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
        if ($rollbackService) {
            if ($serviceCreated) {
                Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
            }
            try {
                Invoke-ServiceControl -Arguments @('delete', $serviceName)
            } catch {
                $rollbackFailures += "Could not delete service '$serviceName': $($_.Exception.Message)"
            }
        }
    }
    if ($eventSourceCreated) {
        try {
            Remove-EventLog -Source $serviceName -ErrorAction Stop
        } catch {
            $rollbackFailures += "Could not remove Event Log source '$serviceName': $($_.Exception.Message)"
        }
    }
    if ($credentialTempPath -and (Test-Path -LiteralPath $credentialTempPath)) {
        try {
            Remove-Item -LiteralPath $credentialTempPath -Force -ErrorAction Stop
        } catch {
            $rollbackFailures += "Could not remove temporary credential: $($_.Exception.Message)"
        }
    }
    if ($dataCreated -and (Test-Path -LiteralPath $dataPath)) {
        try {
            Remove-Item -LiteralPath $dataPath -Recurse -Force -ErrorAction Stop
        } catch {
            $rollbackFailures += "Could not remove data directory '$dataPath': $($_.Exception.Message)"
        }
    }
    if ($installCreated -and (Test-Path -LiteralPath $installPath)) {
        try {
            Remove-Item -LiteralPath $installPath -Recurse -Force -ErrorAction Stop
        } catch {
            $rollbackFailures += "Could not remove install directory '$installPath': $($_.Exception.Message)"
        }
    }
    if ($trayInstallCreated -and (Test-Path -LiteralPath $trayInstallPath)) {
        try { Remove-Item -LiteralPath $trayInstallPath -Recurse -Force } catch { $rollbackFailures += "Could not remove tray install directory '$trayInstallPath': $($_.Exception.Message)" }
    }

    for ($attempt = 0; $attempt -lt 20 -and
        (Get-Service -Name $serviceName -ErrorAction SilentlyContinue); $attempt++) {
        Start-Sleep -Milliseconds 250
    }
    if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
        $rollbackFailures += "Service '$serviceName' still exists after rollback."
    }
    if ($eventSourceCreated -and [Diagnostics.EventLog]::SourceExists($serviceName)) {
        $rollbackFailures += "Event Log source '$serviceName' still exists after rollback."
    }
    foreach ($remainingPath in @($credentialTempPath, $dataPath, $installPath, $trayInstallPath)) {
        if ($remainingPath -and (Test-Path -LiteralPath $remainingPath)) {
            $rollbackFailures += "Path '$remainingPath' still exists after rollback."
        }
    }

    if ($rollbackFailures.Count -gt 0) {
        throw "Installation failed: $($failure.Exception.Message) Rollback incomplete: $($rollbackFailures -join ' ')"
    }
    throw $failure
}
