[CmdletBinding()]
param(
    [string]$PublishPath = (Join-Path $PSScriptRoot '..\publish\win-x64')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$serviceName = 'FieldOpsAgent'
$executableName = 'FieldOps.Agent.exe'
$installPath = Join-Path $env:ProgramFiles 'FieldOpsDashboard\Agent'
$dataPath = Join-Path $env:ProgramData 'FieldOpsDashboard\Agent'

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

    if ($IsDirectory) {
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    } else {
        $acl = New-Object Security.AccessControl.FileSecurity
        $inheritance = [Security.AccessControl.InheritanceFlags]::None
    }

    $acl.SetAccessRuleProtection($true, $false)
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $rules = @(
        [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new('S-1-5-18'),
            [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            $propagation,
            $allow),
        [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'),
            [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            $propagation,
            $allow),
        [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new('S-1-5-19'),
            [Security.AccessControl.FileSystemRights]::ReadAndExecute,
            $inheritance,
            $propagation,
            $allow)
    )

    foreach ($rule in $rules) {
        $acl.AddAccessRule($rule) | Out-Null
    }

    Set-Acl -LiteralPath $Path -AclObject $acl
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
$sourceExecutable = Join-Path $resolvedPublishPath $executableName
if (-not (Test-Path -LiteralPath $sourceExecutable -PathType Leaf)) {
    throw "Published agent executable was not found at '$sourceExecutable'."
}

if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    throw "Service '$serviceName' is already installed. Uninstall it before reinstalling."
}

if ((Test-Path -LiteralPath $installPath) -or (Test-Path -LiteralPath $dataPath)) {
    throw 'Existing FieldOps Agent files were found. Run the uninstaller before reinstalling.'
}

$installCreated = $false
$dataCreated = $false
$eventSourceCreated = $false
$serviceCreated = $false
$credentialTempPath = $null

try {
    New-Item -ItemType Directory -Path $installPath | Out-Null
    $installCreated = $true
    New-Item -ItemType Directory -Path $dataPath | Out-Null
    $dataCreated = $true
    Set-FieldOpsAcl -Path $dataPath -IsDirectory $true
    Assert-FieldOpsAcl -Path $dataPath
    Copy-Item -Path (Join-Path $resolvedPublishPath '*') -Destination $installPath -Recurse -Force

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

    $credentialPath = Join-Path $dataPath 'health-token.dat'
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

    if (-not [Diagnostics.EventLog]::SourceExists($serviceName)) {
        New-EventLog -LogName Application -Source $serviceName
        $eventSourceCreated = $true
    }

    $installedExecutable = Join-Path $installPath $executableName
    $binaryPath = '"{0}"' -f $installedExecutable
    Invoke-ServiceControl -Arguments @('create', $serviceName, "binPath= $binaryPath", 'start= auto', 'obj= NT AUTHORITY\LocalService', 'DisplayName= FieldOps Local Agent')
    $serviceCreated = $true
    Invoke-ServiceControl -Arguments @('description', $serviceName, 'Trusted local service boundary for FieldOps Dashboard.')
    Invoke-ServiceControl -Arguments @('failure', $serviceName, 'reset= 86400', 'actions= restart/5000/restart/15000/restart/30000')

    Start-Service -Name $serviceName
    $service = Get-Service -Name $serviceName
    $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(30))

    Write-Host "FieldOps Local Agent installed and running from '$installPath'."
} catch {
    $failure = $_
    if ($serviceCreated) {
        Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
        & sc.exe delete $serviceName | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Rollback could not delete service '$serviceName' (exit code $LASTEXITCODE)."
        }
    }
    if ($eventSourceCreated) {
        Remove-EventLog -Source $serviceName -ErrorAction SilentlyContinue
    }
    if ($credentialTempPath -and (Test-Path -LiteralPath $credentialTempPath)) {
        Remove-Item -LiteralPath $credentialTempPath -Force -ErrorAction SilentlyContinue
    }
    if ($dataCreated -and (Test-Path -LiteralPath $dataPath)) {
        Remove-Item -LiteralPath $dataPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($installCreated -and (Test-Path -LiteralPath $installPath)) {
        Remove-Item -LiteralPath $installPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw $failure
}
