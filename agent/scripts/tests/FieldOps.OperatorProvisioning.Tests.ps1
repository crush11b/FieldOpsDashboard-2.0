$modulePath = Join-Path $PSScriptRoot '..\FieldOps.OperatorProvisioning.psm1'
Import-Module $modulePath -Force

Describe 'FieldOps operator provisioning identity validation' {
    InModuleScope FieldOps.OperatorProvisioning {
        It 'resolves the current Windows user to a user SID' {
            $resolved = Resolve-FieldOpsLocalOperatorAccount `
                -Account ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
            $resolved.Sid | Should Match '^S-1-5-'
        }

        It 'rejects a group supplied as the operator account' {
            { Resolve-FieldOpsLocalOperatorAccount -Account 'BUILTIN\Users' } |
                Should Throw 'must resolve to a user account'
        }

        It 'rejects an unresolved operator account' {
            { Resolve-FieldOpsLocalOperatorAccount -Account '.\FieldOpsAccountThatMustNotExist' } |
                Should Throw 'could not be resolved'
        }

        It 'resolves an existing temporary local account equivalently with dot and computer-qualified forms' {
            $principal = New-Object Security.Principal.WindowsPrincipal(
                [Security.Principal.WindowsIdentity]::GetCurrent())
            $hasLocalUserCmdlet = $null -ne (Get-Command Get-LocalUser -ErrorAction SilentlyContinue)
            $hasLocalGroupCmdlet = $null -ne (Get-Command New-LocalUser -ErrorAction SilentlyContinue)
            if (-not $hasLocalUserCmdlet -or -not $hasLocalGroupCmdlet -or
                -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
                Set-TestInconclusive 'Requires elevated Windows PowerShell local-account cmdlets.'
                return
            }

            $name = 'FieldOpsPester_{0}' -f ([Guid]::NewGuid().ToString('N').Substring(0, 12))
            $password = ConvertTo-SecureString 'Pester-Only-9!zQ4#' -AsPlainText -Force
            try {
                New-LocalUser -Name $name -Password $password -Description 'Temporary Pester account' |
                    Out-Null
                $dot = Resolve-FieldOpsLocalOperatorAccount -Account ".\$name"
                $qualified = Resolve-FieldOpsLocalOperatorAccount `
                    -Account "$env:COMPUTERNAME\$name"
                $dot.Sid | Should Be $qualified.Sid
            } finally {
                Remove-LocalUser -Name $name -ErrorAction SilentlyContinue
            }
        }

        It 'rejects an invalid ownership-state SID' {
            $statePath = Join-Path $TestDrive 'operator-provisioning.json'
            @{
                schemaVersion = 1
                groupName = 'FieldOps Operators'
                groupSid = 'invalid'
                groupProductOwned = $true
                enrolledAccountName = 'operator'
                enrolledAccountSid = 'S-1-5-21-1-2-3-1001'
                membershipProductOwned = $true
            } | ConvertTo-Json | Set-Content -LiteralPath $statePath

            { Read-FieldOpsOperatorProvisioningState -StatePath $statePath } |
                Should Throw 'contains an invalid SID'
        }

        It 'preserves group state when no ownership record exists' {
            $result = Remove-FieldOpsOperatorProvisioning `
                -StatePath (Join-Path $TestDrive 'missing.json') -WarningAction SilentlyContinue
            $result | Should Be $false
        }
    }
}

Describe 'FieldOps operator provisioning source invariants' {
    $moduleSource = Get-Content -LiteralPath $modulePath -Raw

    It 'uses the canonical local group and SID service environment' {
        $moduleSource | Should Match "CanonicalGroupName = 'FieldOps Operators'"
        $moduleSource | Should Match "OperatorEnvironmentName = 'Agent__NativeHealth__OperatorSid'"
        $moduleSource | Should Match '\$entryPrefix \+ \$GroupSid'
    }

    It 'uses a bounded description when creating the canonical local group' {
        $description = 'FieldOps native health operators'
        $description | Should Not BeNullOrEmpty
        $description.Length | Should BeLessThan 49
        $moduleSource | Should Match 'New-LocalGroup -Name \$script:CanonicalGroupName'
    }

    It 'does not reference credential ACL or telemetry components' {
        $moduleSource | Should Not Match 'health-token\.dat|Set-Acl|TelemetrySenderService|HttpTelemetryDestination'
    }

    It 'tracks created groups and memberships separately' {
        $moduleSource | Should Match 'groupProductOwned = \$groupCreatedThisRun'
        $moduleSource | Should Match 'membershipProductOwned = \$true'
        $moduleSource | Should Match 'MembershipAddedThisRun'
    }

    It 'preserves administrator-owned groups on uninstall and rollback' {
        $moduleSource | Should Match '\$membershipAddedThisRun -and -not \$groupCreatedThisRun'
        $moduleSource | Should Match '\[bool\]\$state\.groupProductOwned -and \$unrelatedMembers\.Count -eq 0'
        $moduleSource | Should Match 'preserving group and membership state'
    }
}
