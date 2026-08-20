Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$operatorProvisioningModule = Join-Path $PSScriptRoot 'FieldOps.OperatorProvisioning.psm1'
Import-Module $operatorProvisioningModule -Force

function Get-FieldOpsInteractiveSessionCandidates {
    [CmdletBinding()]
    param(
        [scriptblock]$ExplorerProvider = { Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" -ErrorAction Stop },
        [scriptblock]$OwnerResolver = { param($Process) Invoke-CimMethod -InputObject $Process -MethodName GetOwner -ErrorAction Stop },
        [scriptblock]$AccountResolver = { param($Account) Resolve-FieldOpsLocalOperatorAccount -Account $Account }
    )

    foreach ($process in @(& $ExplorerProvider)) {
        $owner = & $OwnerResolver $process
        if ($null -eq $owner -or [int]$owner.ReturnValue -ne 0) { continue }
        $user = [string]$owner.User
        $domain = [string]$owner.Domain
        if ([string]::IsNullOrWhiteSpace($user)) { continue }
        $candidate = if ([string]::IsNullOrWhiteSpace($domain)) { $user } else { '{0}\{1}' -f $domain, $user }
        $resolved = & $AccountResolver $candidate
        [pscustomobject]@{
            Account = [string]$resolved.Name
            Sid = [string]$resolved.Sid
            SessionId = [int]$process.SessionId
            ProcessId = [int]$process.ProcessId
        }
    }
}

function Get-FieldOpsTrayProcessCandidates {
    [CmdletBinding()]
    param(
        [scriptblock]$ProcessProvider = { Get-CimInstance Win32_Process -Filter "Name = 'FieldOps.Tray.exe'" -ErrorAction SilentlyContinue },
        [scriptblock]$OwnerResolver = { param($Process) Invoke-CimMethod -InputObject $Process -MethodName GetOwner -ErrorAction Stop },
        [scriptblock]$AccountResolver = { param($Account) Resolve-FieldOpsLocalOperatorAccount -Account $Account }
    )

    foreach ($process in @(& $ProcessProvider)) {
        if ([string]::IsNullOrWhiteSpace([string]$process.ExecutablePath)) { continue }
        try {
            $owner = & $OwnerResolver $process
            if ($null -eq $owner -or [int]$owner.ReturnValue -ne 0) { continue }
            $user = [string]$owner.User
            $domain = [string]$owner.Domain
            if ([string]::IsNullOrWhiteSpace($user)) { continue }
            $candidate = if ([string]::IsNullOrWhiteSpace($domain)) { $user } else { '{0}\{1}' -f $domain, $user }
            $resolved = & $AccountResolver $candidate
            [pscustomobject]@{
                Account = [string]$resolved.Name
                Sid = [string]$resolved.Sid
                SessionId = [int]$process.SessionId
                ProcessId = [int]$process.ProcessId
                ExecutablePath = [string]$process.ExecutablePath
            }
        } catch {
        }
    }
}

Export-ModuleMember -Function Get-FieldOpsInteractiveSessionCandidates, Get-FieldOpsTrayProcessCandidates
