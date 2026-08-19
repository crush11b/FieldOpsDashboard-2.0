Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$operatorProvisioningModule = Join-Path $PSScriptRoot 'FieldOps.OperatorProvisioning.psm1'
Import-Module $operatorProvisioningModule -Force

function Get-FieldOpsInteractiveOperatorCandidates {
    [CmdletBinding()]
    param(
        [scriptblock]$ComputerSystemProvider = { Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop },
        [scriptblock]$ExplorerProvider = { Get-CimInstance -ClassName Win32_Process -Filter "Name = 'explorer.exe'" -ErrorAction Stop },
        [scriptblock]$OwnerResolver = { param($Process) Invoke-CimMethod -InputObject $Process -MethodName GetOwner -ErrorAction Stop }
    )

    $candidateNames = @{}
    foreach ($computer in @(& $ComputerSystemProvider)) {
        $name = [string]$computer.UserName
        if (-not [string]::IsNullOrWhiteSpace($name)) {
            $candidateNames[$name.ToLowerInvariant()] = $name
        }
    }

    try {
        foreach ($process in @(& $ExplorerProvider)) {
            $owner = & $OwnerResolver $process
            if ($null -eq $owner -or [int]$owner.ReturnValue -ne 0) { continue }
            $user = [string]$owner.User
            $domain = [string]$owner.Domain
            if ([string]::IsNullOrWhiteSpace($user)) { continue }
            $name = if ([string]::IsNullOrWhiteSpace($domain)) { $user } else { '{0}\{1}' -f $domain, $user }
            $candidateNames[$name.ToLowerInvariant()] = $name
        }
    } catch {
        # Win32_ComputerSystem remains sufficient when explorer ownership is unavailable.
    }

    return @($candidateNames.Values | Sort-Object)
}

function Resolve-FieldOpsInteractiveOperator {
    [CmdletBinding()]
    param(
        [string]$OperatorAccount,
        [scriptblock]$CandidateProvider = { Get-FieldOpsInteractiveOperatorCandidates },
        [scriptblock]$AccountResolver = { param($Account) Resolve-FieldOpsLocalOperatorAccount -Account $Account }
    )

    if (-not [string]::IsNullOrWhiteSpace($OperatorAccount)) {
        try {
            $resolved = & $AccountResolver $OperatorAccount
        } catch {
            throw $_
        }
        return [pscustomobject]@{
            Account = [string]$resolved.Name
            Sid = [string]$resolved.Sid
            Source = 'explicit'
            Candidate = $OperatorAccount
        }
    }

    $candidates = @(& $CandidateProvider | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    if ($candidates.Count -eq 0) {
        throw 'No active interactive FieldOps operator could be resolved; supply -OperatorAccount explicitly.'
    }
    if ($candidates.Count -ne 1) {
        throw "Interactive FieldOps operator is ambiguous ($($candidates -join ', ')); supply -OperatorAccount explicitly."
    }

    $candidate = [string]$candidates[0]
    try {
        $resolved = & $AccountResolver $candidate
    } catch {
        throw "Active interactive operator '$candidate' could not be validated: $($_.Exception.Message)"
    }
    return [pscustomobject]@{
        Account = [string]$resolved.Name
        Sid = [string]$resolved.Sid
        Source = 'interactive'
        Candidate = $candidate
    }
}

Export-ModuleMember -Function Get-FieldOpsInteractiveOperatorCandidates, Resolve-FieldOpsInteractiveOperator
