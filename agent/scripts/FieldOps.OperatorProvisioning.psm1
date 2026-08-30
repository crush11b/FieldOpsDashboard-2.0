Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:CanonicalGroupName = 'FieldOps Operators'
$script:OperatorEnvironmentName = 'Agent__NativeHealth__OperatorSid'
$script:StateSchemaVersion = 1

if ($null -eq ('FieldOpsDashboard.Deployment.AccountSidLookup' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace FieldOpsDashboard.Deployment
{
    public static class AccountSidLookup
    {
        public static int GetAccountType(string sidValue)
        {
            var sid = new SecurityIdentifier(sidValue);
            var bytes = new byte[sid.BinaryLength];
            sid.GetBinaryForm(bytes, 0);
            uint nameLength = 0;
            uint domainLength = 0;
            int accountType;
            LookupAccountSid(null, bytes, null, ref nameLength, null, ref domainLength, out accountType);
            const int insufficientBuffer = 122;
            if (Marshal.GetLastWin32Error() != insufficientBuffer)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            var name = new StringBuilder((int)nameLength);
            var domain = new StringBuilder((int)domainLength);
            if (!LookupAccountSid(null, bytes, name, ref nameLength, domain, ref domainLength, out accountType))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            return accountType;
        }

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool LookupAccountSid(
            string systemName,
            byte[] sid,
            StringBuilder name,
            ref uint nameLength,
            StringBuilder referencedDomainName,
            ref uint referencedDomainNameLength,
            out int accountType);
    }
}
'@
}

function Get-FieldOpsCanonicalOperatorGroupName {
    return $script:CanonicalGroupName
}

function Get-FieldOpsOperatorEnvironmentName {
    return $script:OperatorEnvironmentName
}

function Get-FieldOpsLocalGroup {
    param([Parameter(Mandatory = $true)][string]$Name)

    $groups = @(Get-LocalGroup -Name $Name -ErrorAction SilentlyContinue)
    if ($groups.Count -eq 0) {
        return $null
    }
    if ($groups.Count -ne 1 -or
        -not [string]::Equals($groups[0].Name, $Name, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Local group identity '$Name' is ambiguous."
    }
    if ([string]$groups[0].PrincipalSource -ne 'Local' -or $null -eq $groups[0].SID) {
        throw "Identity '$Name' is not an unambiguous local security group."
    }

    return $groups[0]
}

function Resolve-FieldOpsLocalOperatorAccount {
    param([Parameter(Mandatory = $true)][string]$Account)

    if ([string]::IsNullOrWhiteSpace($Account)) {
        throw 'An explicit operator account is required.'
    }

    $normalizedAccount = $Account
    if ($Account.StartsWith('.\', [StringComparison]::Ordinal)) {
        $localName = $Account.Substring(2)
        if ([string]::IsNullOrWhiteSpace($localName)) {
            throw "Operator account '$Account' could not be resolved."
        }
        $normalizedAccount = '{0}\{1}' -f $env:COMPUTERNAME, $localName
    }

    try {
        $accountSid = ([Security.Principal.NTAccount]$normalizedAccount).Translate(
            [Security.Principal.SecurityIdentifier])
    } catch [Security.Principal.IdentityNotMappedException] {
        throw "Operator account '$Account' could not be resolved."
    }

    try {
        $accountType = [FieldOpsDashboard.Deployment.AccountSidLookup]::GetAccountType($accountSid.Value)
    } catch {
        throw "Operator account '$Account' could not be resolved unambiguously."
    }
    if ($accountType -ne 1) {
        throw "Operator account '$Account' must resolve to a user account, not a group or another identity type."
    }

    return [pscustomobject]@{
        Name = [string]$accountSid.Translate([Security.Principal.NTAccount]).Value
        Sid = [string]$accountSid.Value
    }
}

function Read-FieldOpsOperatorProvisioningState {
    param([Parameter(Mandatory = $true)][string]$StatePath)

    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
        return $null
    }

    try {
        $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    } catch {
        throw "FieldOps operator ownership state at '$StatePath' is unreadable."
    }

    if ($state.schemaVersion -ne $script:StateSchemaVersion -or
        $state.groupName -ne $script:CanonicalGroupName -or
        [string]::IsNullOrWhiteSpace([string]$state.groupSid) -or
        [string]::IsNullOrWhiteSpace([string]$state.enrolledAccountSid) -or
        $state.groupProductOwned -isnot [bool] -or
        $state.membershipProductOwned -isnot [bool]) {
        throw "FieldOps operator ownership state at '$StatePath' is invalid."
    }

    try {
        [void][Security.Principal.SecurityIdentifier]::new([string]$state.groupSid)
        [void][Security.Principal.SecurityIdentifier]::new([string]$state.enrolledAccountSid)
    } catch [ArgumentException] {
        throw "FieldOps operator ownership state at '$StatePath' contains an invalid SID."
    }

    return $state
}

function Write-FieldOpsOperatorProvisioningState {
    param(
        [Parameter(Mandatory = $true)][string]$StatePath,
        [Parameter(Mandatory = $true)]$State
    )

    $parent = Split-Path -Parent $StatePath
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        throw "The protected FieldOps data directory '$parent' does not exist."
    }

    $temporaryPath = Join-Path $parent ('.operator-provisioning-{0}.tmp' -f [Guid]::NewGuid().ToString('N'))
    try {
        $json = $State | ConvertTo-Json -Depth 3
        [IO.File]::WriteAllText($temporaryPath, $json, [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporaryPath -Destination $StatePath -Force
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Test-FieldOpsLocalGroupMembership {
    param(
        [Parameter(Mandatory = $true)][string]$GroupName,
        [Parameter(Mandatory = $true)][string]$AccountSid
    )

    $members = @(Get-LocalGroupMember -Group $GroupName -ErrorAction Stop)
    return @($members | Where-Object { $_.SID -and $_.SID.Value -eq $AccountSid }).Count -eq 1
}

function New-FieldOpsOperatorProvisioning {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$OperatorAccount,
        [Parameter(Mandatory = $true)][string]$StatePath
    )

    $operator = Resolve-FieldOpsLocalOperatorAccount -Account $OperatorAccount
    $existingState = Read-FieldOpsOperatorProvisioningState -StatePath $StatePath
    $groupCreatedThisRun = $false
    $membershipAddedThisRun = $false
    $stateWrittenThisRun = $false

    try {
        $group = Get-FieldOpsLocalGroup -Name $script:CanonicalGroupName
        if ($null -eq $group) {
            $group = New-LocalGroup -Name $script:CanonicalGroupName `
                -Description 'FieldOps native health operators'
            $groupCreatedThisRun = $true
            $group = Get-FieldOpsLocalGroup -Name $script:CanonicalGroupName
            if ($null -eq $group) {
                throw "The product-created '$($script:CanonicalGroupName)' group could not be resolved."
            }
        }

        $groupSid = [string]$group.SID.Value
        if ($existingState) {
            if ([string]$existingState.groupSid -ne $groupSid -or
                [string]$existingState.enrolledAccountSid -ne $operator.Sid) {
                throw 'Existing FieldOps operator ownership state does not match the resolved group and operator account.'
            }
            $groupProductOwned = [bool]$existingState.groupProductOwned
            $membershipProductOwned = [bool]$existingState.membershipProductOwned
        } else {
            $groupProductOwned = $groupCreatedThisRun
            $membershipProductOwned = $false
        }

        $isMember = Test-FieldOpsLocalGroupMembership `
            -GroupName $script:CanonicalGroupName `
            -AccountSid $operator.Sid
        if ($existingState -and -not $isMember) {
            throw 'Existing FieldOps operator ownership state exists, but its tracked membership is missing.'
        }
        if (-not $isMember) {
            Add-LocalGroupMember -Group $script:CanonicalGroupName -Member $operator.Sid
            $membershipAddedThisRun = $true
            $membershipProductOwned = $true
        }

        if (-not (Test-FieldOpsLocalGroupMembership -GroupName $script:CanonicalGroupName -AccountSid $operator.Sid)) {
            throw "Operator account '$($operator.Name)' was not enrolled in '$($script:CanonicalGroupName)'."
        }

        $state = [ordered]@{
            schemaVersion = $script:StateSchemaVersion
            groupName = $script:CanonicalGroupName
            groupSid = $groupSid
            groupProductOwned = $groupProductOwned
            enrolledAccountName = $operator.Name
            enrolledAccountSid = $operator.Sid
            membershipProductOwned = $membershipProductOwned
        }
        if (-not $existingState) {
            Write-FieldOpsOperatorProvisioningState -StatePath $StatePath -State $state
            $stateWrittenThisRun = $true
        }

        return [pscustomobject]@{
            GroupName = $script:CanonicalGroupName
            GroupSid = $groupSid
            OperatorName = $operator.Name
            OperatorSid = $operator.Sid
            GroupProductOwned = $groupProductOwned
            MembershipProductOwned = $membershipProductOwned
            GroupCreatedThisRun = $groupCreatedThisRun
            MembershipAddedThisRun = $membershipAddedThisRun
            StateWrittenThisRun = $stateWrittenThisRun
            StatePath = $StatePath
        }
    } catch {
        $failure = $_
        $rollbackFailures = @()
        if ($membershipAddedThisRun -and -not $groupCreatedThisRun) {
            try {
                Remove-LocalGroupMember -Group $script:CanonicalGroupName -Member $operator.Sid -Confirm:$false
            } catch {
                $rollbackFailures += 'Could not remove the newly added operator membership.'
            }
        }
        if ($groupCreatedThisRun) {
            try {
                Remove-LocalGroup -Name $script:CanonicalGroupName
            } catch {
                $rollbackFailures += 'Could not remove the newly created operator group.'
            }
        }
        if ($rollbackFailures.Count -eq 0 -and
            $stateWrittenThisRun -and
            (Test-Path -LiteralPath $StatePath)) {
            try {
                Remove-Item -LiteralPath $StatePath -Force
            } catch {
                $rollbackFailures += 'Could not remove newly written operator ownership state.'
            }
        }

        if ($rollbackFailures.Count -gt 0) {
            throw "Operator provisioning failed: $($failure.Exception.Message) Rollback incomplete: $($rollbackFailures -join ' ')"
        }
        throw $failure
    }
}

function Get-FieldOpsServiceRegistryPath {
    param([Parameter(Mandatory = $true)][string]$ServiceName)

    return "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
}

function Get-FieldOpsServiceEnvironment {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ServiceName)

    $servicePath = Get-FieldOpsServiceRegistryPath -ServiceName $ServiceName
    if (-not (Test-Path -LiteralPath $servicePath -PathType Container)) {
        return [pscustomobject]@{ Exists = $false; Entries = @() }
    }

    $property = Get-ItemProperty -LiteralPath $servicePath -Name Environment -ErrorAction SilentlyContinue
    if ($null -eq $property) {
        return [pscustomobject]@{ Exists = $false; Entries = @() }
    }

    return [pscustomobject]@{ Exists = $true; Entries = @($property.Environment) }
}

function Restore-FieldOpsServiceEnvironment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [Parameter(Mandatory = $true)][bool]$Exists,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Entries
    )

    $servicePath = Get-FieldOpsServiceRegistryPath -ServiceName $ServiceName
    if (-not (Test-Path -LiteralPath $servicePath -PathType Container)) {
        return
    }

    if ($Exists) {
        New-ItemProperty -LiteralPath $servicePath -Name Environment -PropertyType MultiString `
            -Value $Entries -Force | Out-Null
    } else {
        Remove-ItemProperty -LiteralPath $servicePath -Name Environment -ErrorAction SilentlyContinue
    }
}

function Set-FieldOpsOperatorServiceEnvironment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [Parameter(Mandatory = $true)][string]$GroupSid,
        [Parameter(Mandatory = $false)][AllowEmptyCollection()][string[]]$AdditionalEntries = @()
    )

    [void][Security.Principal.SecurityIdentifier]::new($GroupSid)
    $servicePath = Get-FieldOpsServiceRegistryPath -ServiceName $ServiceName
    if (-not (Test-Path -LiteralPath $servicePath -PathType Container)) {
        throw "Service registry configuration for '$ServiceName' does not exist."
    }

    $entryPrefix = $script:OperatorEnvironmentName + '='
    $property = Get-ItemProperty -LiteralPath $servicePath -Name Environment -ErrorAction SilentlyContinue
    $current = if ($null -eq $property) { @() } else { @($property.Environment) }
    $preserved = @($current | Where-Object {
        -not ([string]$_).StartsWith($entryPrefix, [StringComparison]::OrdinalIgnoreCase)
    })
    $updated = @($preserved + $AdditionalEntries + ($entryPrefix + $GroupSid))
    New-ItemProperty -LiteralPath $servicePath -Name Environment -PropertyType MultiString `
        -Value $updated -Force | Out-Null
}

function Remove-FieldOpsOperatorServiceEnvironment {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ServiceName)

    $servicePath = Get-FieldOpsServiceRegistryPath -ServiceName $ServiceName
    if (-not (Test-Path -LiteralPath $servicePath -PathType Container)) {
        return
    }

    $entryPrefix = $script:OperatorEnvironmentName + '='
    $property = Get-ItemProperty -LiteralPath $servicePath -Name Environment -ErrorAction SilentlyContinue
    if ($null -eq $property) {
        return
    }
    $current = @($property.Environment)
    $preserved = @($current | Where-Object {
        -not ([string]$_).StartsWith($entryPrefix, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($preserved.Count -eq 0) {
        Remove-ItemProperty -LiteralPath $servicePath -Name Environment -ErrorAction SilentlyContinue
    } else {
        New-ItemProperty -LiteralPath $servicePath -Name Environment -PropertyType MultiString `
            -Value $preserved -Force | Out-Null
    }
}

function Undo-FieldOpsOperatorProvisioningAttempt {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Provisioning)

    $failures = @()
    if ($Provisioning.MembershipAddedThisRun -and -not $Provisioning.GroupCreatedThisRun) {
        try {
            Remove-LocalGroupMember -Group $Provisioning.GroupName -Member $Provisioning.OperatorSid -Confirm:$false
        } catch {
            $failures += 'Could not roll back the newly added operator membership.'
        }
    }
    if ($Provisioning.GroupCreatedThisRun) {
        try {
            Remove-LocalGroup -Name $Provisioning.GroupName
        } catch {
            $failures += 'Could not roll back the newly created operator group.'
        }
    }
    if ($failures.Count -eq 0 -and
        $Provisioning.StateWrittenThisRun -and
        (Test-Path -LiteralPath $Provisioning.StatePath)) {
        try {
            Remove-Item -LiteralPath $Provisioning.StatePath -Force
        } catch {
            $failures += 'Could not remove the newly written operator ownership state.'
        }
    }
    if ($failures.Count -gt 0) {
        throw ($failures -join ' ')
    }
}

function Remove-FieldOpsOperatorProvisioning {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$StatePath)

    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
        Write-Warning 'FieldOps operator ownership state is absent; preserving all group and membership state.'
        return $false
    }

    $state = Read-FieldOpsOperatorProvisioningState -StatePath $StatePath
    $group = Get-FieldOpsLocalGroup -Name $script:CanonicalGroupName
    if ($null -eq $group -or [string]$group.SID.Value -ne [string]$state.groupSid) {
        Write-Warning 'FieldOps operator-group ownership cannot be proven; preserving group and membership state.'
        return $false
    }

    $members = @(Get-LocalGroupMember -Group $script:CanonicalGroupName -ErrorAction Stop)
    $unrelatedMembers = @($members | Where-Object {
        -not $_.SID -or $_.SID.Value -ne [string]$state.enrolledAccountSid
    })

    if ([bool]$state.groupProductOwned -and $unrelatedMembers.Count -eq 0) {
        Remove-LocalGroup -Name $script:CanonicalGroupName
    } else {
        if ([bool]$state.membershipProductOwned -and
            (Test-FieldOpsLocalGroupMembership -GroupName $script:CanonicalGroupName `
                -AccountSid ([string]$state.enrolledAccountSid))) {
            Remove-LocalGroupMember -Group $script:CanonicalGroupName `
                -Member ([string]$state.enrolledAccountSid) -Confirm:$false
        }
    }

    Remove-Item -LiteralPath $StatePath -Force
    return $true
}

Export-ModuleMember -Function @(
    'Get-FieldOpsCanonicalOperatorGroupName',
    'Get-FieldOpsOperatorEnvironmentName',
    'Resolve-FieldOpsLocalOperatorAccount',
    'Read-FieldOpsOperatorProvisioningState',
    'Get-FieldOpsServiceEnvironment',
    'Restore-FieldOpsServiceEnvironment',
    'New-FieldOpsOperatorProvisioning',
    'Set-FieldOpsOperatorServiceEnvironment',
    'Remove-FieldOpsOperatorServiceEnvironment',
    'Undo-FieldOpsOperatorProvisioningAttempt',
    'Remove-FieldOpsOperatorProvisioning'
)
