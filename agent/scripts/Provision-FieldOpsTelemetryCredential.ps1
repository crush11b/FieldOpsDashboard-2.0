[CmdletBinding()]
param(
    [string]$AgentId,
    [switch]$Rotate,
    [string]$DashboardIdentity,
    [string]$ReceiverCredentialPath = (Join-Path $env:ProgramData 'FieldOpsDashboard\Dashboard\telemetry-credentials.json'),
    [string]$AgentCredentialPath = (Join-Path $env:ProgramData 'FieldOpsDashboard\Agent\telemetry-write-token.dat')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

function ConvertTo-Base64Url {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)
    return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-TokenDigest {
    param([Parameter(Mandatory = $true)][string]$Token)
    $bytes = [Text.Encoding]::ASCII.GetBytes($Token)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { return ConvertTo-Base64Url -Bytes $sha.ComputeHash($bytes) } finally { $sha.Dispose() }
    } finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
    }
}

function New-TelemetryToken {
    $bytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($bytes)
        return ConvertTo-Base64Url -Bytes $bytes
    } finally {
        $random.Dispose()
        [Array]::Clear($bytes, 0, $bytes.Length)
    }
}

function Set-ProtectedAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][Security.Principal.SecurityIdentifier[]]$ReadSids,
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
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $none = [Security.AccessControl.PropagationFlags]::None
    foreach ($sid in @(
        [Security.Principal.SecurityIdentifier]::new('S-1-5-18'),
        [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $sid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, $none, $allow)) | Out-Null
    }
    foreach ($sid in $ReadSids) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $sid, [Security.AccessControl.FileSystemRights]::ReadAndExecute, $inheritance, $none, $allow)) | Out-Null
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Assert-ProtectedAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$AllowedSids
    )
    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) { throw "ACL inheritance remains enabled on '$Path'." }
    $rules = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
    foreach ($rule in $rules) {
        if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            $AllowedSids -notcontains $rule.IdentityReference.Value) {
            throw "Unexpected ACL entry on protected telemetry credential material."
        }
    }
    foreach ($sid in $AllowedSids) {
        if (-not ($rules | Where-Object { $_.IdentityReference.Value -eq $sid })) {
            throw "A required ACL entry is missing from protected telemetry credential material."
        }
    }
}

function Read-ReceiverRecord {
    param([Parameter(Mandatory = $true)][string]$Path)
    $repository = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if ($repository.schemaVersion -ne 1 -or @($repository.records).Count -ne 1) {
        throw 'Receiver telemetry credential repository has an unsupported or invalid schema.'
    }
    $record = @($repository.records)[0]
    if ($record.agentId -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' -or
        $record.tokenDigest -notmatch '^[A-Za-z0-9_-]{43}$' -or
        $record.enabled -ne $true -or
        @($record.scopes) -notcontains 'telemetry:write') {
        throw 'Receiver telemetry credential repository contains an invalid record.'
    }
    return $record
}

function Assert-CredentialPair {
    param(
        [Parameter(Mandatory = $true)][string]$ReceiverPath,
        [Parameter(Mandatory = $true)][string]$AgentPath,
        [Parameter(Mandatory = $true)][string]$ExpectedAgentId
    )
    $record = Read-ReceiverRecord -Path $ReceiverPath
    $protected = [IO.File]::ReadAllBytes($AgentPath)
    $plaintext = [Security.Cryptography.ProtectedData]::Unprotect(
        $protected, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    try {
        $token = [Text.Encoding]::ASCII.GetString($plaintext)
        if ($token -notmatch '^[A-Za-z0-9_-]{43}$' -or
            (Get-TokenDigest -Token $token) -ne $record.tokenDigest -or
            $record.agentId -ne $ExpectedAgentId) {
            throw 'Provisioned telemetry credential pair failed verification.'
        }
    } finally {
        [Array]::Clear($plaintext, 0, $plaintext.Length)
        [Array]::Clear($protected, 0, $protected.Length)
        $token = $null
    }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Telemetry credential provisioning must run from an elevated PowerShell session.'
}
if ([string]::IsNullOrWhiteSpace($DashboardIdentity)) { $DashboardIdentity = $identity.Name }
$dashboardSid = ([Security.Principal.NTAccount]$DashboardIdentity).Translate([Security.Principal.SecurityIdentifier])
$localServiceSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-19')

$receiverExists = Test-Path -LiteralPath $ReceiverCredentialPath -PathType Leaf
$agentExists = Test-Path -LiteralPath $AgentCredentialPath -PathType Leaf
if (($receiverExists -or $agentExists) -and -not $Rotate) {
    throw 'Telemetry credentials already exist. Use -Rotate to replace them explicitly.'
}
if ($Rotate -and (-not $receiverExists -or -not $agentExists)) {
    throw 'Rotation requires an existing complete telemetry credential pair.'
}

$previousRecord = $null
if ($Rotate) {
    $previousRecord = Read-ReceiverRecord -Path $ReceiverCredentialPath
    if ([string]::IsNullOrWhiteSpace($AgentId)) { $AgentId = $previousRecord.agentId }
    elseif ($AgentId -ne $previousRecord.agentId) { throw 'Rotation cannot change the receiver-owned agent ID.' }
}
if ([string]::IsNullOrWhiteSpace($AgentId)) { $AgentId = 'agent-' + [Guid]::NewGuid().ToString('N') }
if ($AgentId -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') { throw 'AgentId has an invalid format.' }

$receiverDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($ReceiverCredentialPath))
$agentDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($AgentCredentialPath))
New-Item -ItemType Directory -Path $receiverDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $agentDirectory -Force | Out-Null
Set-ProtectedAcl -Path $receiverDirectory -ReadSids @($dashboardSid) -IsDirectory $true
Set-ProtectedAcl -Path $agentDirectory -ReadSids @($localServiceSid) -IsDirectory $true

$transaction = [Guid]::NewGuid().ToString('N')
$receiverTemp = Join-Path $receiverDirectory ".telemetry-credentials-$transaction.tmp"
$agentTemp = Join-Path $agentDirectory ".telemetry-write-token-$transaction.tmp"
$receiverBackup = "$ReceiverCredentialPath.$transaction.bak"
$agentBackup = "$AgentCredentialPath.$transaction.bak"
$token = $null
$committed = $false
$agentSwapped = $false
$receiverSwapped = $false
try {
    $token = New-TelemetryToken
    $digest = Get-TokenDigest -Token $token
    $now = [DateTimeOffset]::UtcNow.ToString('o')
    $record = [ordered]@{
        agentId = $AgentId
        tokenDigest = $digest
        scopes = @('telemetry:write')
        enabled = $true
        createdAt = if ($previousRecord) { $previousRecord.createdAt } else { $now }
    }
    if ($previousRecord) { $record.rotatedAt = $now }
    $repository = [ordered]@{ schemaVersion = 1; records = @($record) }
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($receiverTemp, ($repository | ConvertTo-Json -Depth 5), $utf8NoBom)

    $plaintext = [Text.Encoding]::ASCII.GetBytes($token)
    $protected = $null
    try {
        $protected = [Security.Cryptography.ProtectedData]::Protect(
            $plaintext, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
        [IO.File]::WriteAllBytes($agentTemp, $protected)
    } finally {
        [Array]::Clear($plaintext, 0, $plaintext.Length)
        if ($protected) { [Array]::Clear($protected, 0, $protected.Length) }
    }

    Set-ProtectedAcl -Path $receiverTemp -ReadSids @($dashboardSid) -IsDirectory $false
    Set-ProtectedAcl -Path $agentTemp -ReadSids @($localServiceSid) -IsDirectory $false
    Assert-CredentialPair -ReceiverPath $receiverTemp -AgentPath $agentTemp -ExpectedAgentId $AgentId

    if ($agentExists) {
        [IO.File]::Replace($agentTemp, $AgentCredentialPath, $agentBackup, $true)
    } else {
        Move-Item -LiteralPath $agentTemp -Destination $AgentCredentialPath
    }
    $agentSwapped = $true
    if ($receiverExists) {
        [IO.File]::Replace($receiverTemp, $ReceiverCredentialPath, $receiverBackup, $true)
    } else {
        Move-Item -LiteralPath $receiverTemp -Destination $ReceiverCredentialPath
    }
    $receiverSwapped = $true
    Assert-ProtectedAcl -Path $ReceiverCredentialPath -AllowedSids @('S-1-5-18', 'S-1-5-32-544', $dashboardSid.Value)
    Assert-ProtectedAcl -Path $AgentCredentialPath -AllowedSids @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-19')
    Assert-CredentialPair -ReceiverPath $ReceiverCredentialPath -AgentPath $AgentCredentialPath -ExpectedAgentId $AgentId
    $committed = $true
} catch {
    $failure = $_
    $rollbackFailures = New-Object System.Collections.Generic.List[string]
    foreach ($item in @(
        @{ Swapped = $receiverSwapped; Current = $ReceiverCredentialPath; Backup = $receiverBackup; Name = 'receiver' },
        @{ Swapped = $agentSwapped; Current = $AgentCredentialPath; Backup = $agentBackup; Name = 'agent' })) {
        try {
            if ($item.Swapped -and (Test-Path -LiteralPath $item.Current)) {
                Remove-Item -LiteralPath $item.Current -Force
            }
            if (Test-Path -LiteralPath $item.Backup) {
                Move-Item -LiteralPath $item.Backup -Destination $item.Current
            }
        } catch {
            $rollbackFailures.Add($item.Name) | Out-Null
        }
    }
    if ($rollbackFailures.Count -gt 0) {
        throw "Telemetry credential provisioning failed and rollback was incomplete for: $($rollbackFailures -join ', '). Protected backups were retained."
    }
    throw "Telemetry credential provisioning failed safely: $($failure.Exception.Message)"
} finally {
    $token = $null
    foreach ($temporaryPath in @($receiverTemp, $agentTemp)) {
        if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
    }
    if ($committed) {
        foreach ($backupPath in @($receiverBackup, $agentBackup)) {
            if (Test-Path -LiteralPath $backupPath) { Remove-Item -LiteralPath $backupPath -Force }
        }
    }
}

if ($committed) {
    $action = if ($Rotate) { 'rotated' } else { 'created' }
    Write-Host "Telemetry credential $action for agent '$AgentId'."
    Write-Host "Receiver repository: $ReceiverCredentialPath"
    Write-Host "Agent protected credential: $AgentCredentialPath"
    Write-Host 'Provisioning does not activate telemetry delivery.'
}
