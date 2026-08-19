$modulePath = Join-Path $PSScriptRoot '..\FieldOps.OperatorResolution.psm1'
$updaterPath = Join-Path $PSScriptRoot '..\..\..\UpdateDashboard.ps1'
Import-Module $modulePath -Force

function New-TestAccountResolver {
    return {
        param($Account)
        [pscustomobject]@{
            Name = if ($Account.StartsWith('.\')) { 'DESKTOP-88DQ68K\' + $Account.Substring(2) } else { $Account }
            Sid = 'S-1-5-21-100-200-300-1001'
        }
    }
}

Describe 'FieldOps interactive operator resolution' {
    It 'preserves an explicit valid local account and marks it explicit' {
        $resolved = Resolve-FieldOpsInteractiveOperator `
            -OperatorAccount '.\stick' `
            -CandidateProvider { 'DESKTOP-88DQ68K\detected-user' } `
            -AccountResolver (New-TestAccountResolver)

        $resolved.Account | Should Be 'DESKTOP-88DQ68K\stick'
        $resolved.Source | Should Be 'explicit'
    }

    It 'validates an explicit current-user dot account through provisioning' {
        $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name.Split('\')[-1]
        $resolved = Resolve-FieldOpsInteractiveOperator -OperatorAccount ".\$currentUser"

        $resolved.Source | Should Be 'explicit'
        $resolved.Sid | Should Match '^S-1-5-'
    }

    It 'fails clearly for an invalid explicit account' {
        $resolver = { param($Account) throw "Operator account '$Account' could not be resolved." }

        { Resolve-FieldOpsInteractiveOperator -OperatorAccount '.\missing' -AccountResolver $resolver } |
            Should Throw 'could not be resolved'
    }

    It 'gives an explicit account precedence over detected interactive users' {
        $resolved = Resolve-FieldOpsInteractiveOperator `
            -OperatorAccount '.\stick' `
            -CandidateProvider { 'DESKTOP-88DQ68K\other-user' } `
            -AccountResolver (New-TestAccountResolver)

        $resolved.Candidate | Should Be '.\stick'
        $resolved.Account | Should Be 'DESKTOP-88DQ68K\stick'
    }

    It 'auto-resolves one active local interactive user' {
        $resolved = Resolve-FieldOpsInteractiveOperator `
            -CandidateProvider { 'DESKTOP-88DQ68K\stick' } `
            -AccountResolver (New-TestAccountResolver)

        $resolved.Account | Should Be 'DESKTOP-88DQ68K\stick'
        $resolved.Source | Should Be 'interactive'
    }

    It 'does not use the elevated process identity when the detected user differs' {
        $elevatedIdentity = 'DESKTOP-88DQ68K\Administrator'
        $resolved = Resolve-FieldOpsInteractiveOperator `
            -CandidateProvider { 'DESKTOP-88DQ68K\stick' } `
            -AccountResolver { param($Account) [pscustomobject]@{ Name = $Account; Sid = 'S-1-5-21-100-200-300-1001' } }

        $resolved.Account | Should Be 'DESKTOP-88DQ68K\stick'
        $resolved.Account | Should Not Be $elevatedIdentity
    }

    It 'fails when no interactive user is available' {
        { Resolve-FieldOpsInteractiveOperator -CandidateProvider { @() } -AccountResolver (New-TestAccountResolver) } |
            Should Throw 'supply -OperatorAccount explicitly'
    }

    It 'fails when multiple interactive users are plausible' {
        { Resolve-FieldOpsInteractiveOperator -CandidateProvider { @('DESKTOP-88DQ68K\stick', 'DESKTOP-88DQ68K\other') } -AccountResolver (New-TestAccountResolver) } |
            Should Throw 'ambiguous'
    }

    It 'uses Win32 computer and explorer evidence and deduplicates one user' {
        $candidates = Get-FieldOpsInteractiveOperatorCandidates `
            -ComputerSystemProvider { [pscustomobject]@{ UserName = 'DESKTOP-88DQ68K\stick' } } `
            -ExplorerProvider { @([pscustomobject]@{ ProcessId = 10 }) } `
            -OwnerResolver { param($Process) [pscustomobject]@{ ReturnValue = 0; Domain = 'DESKTOP-88DQ68K'; User = 'stick' } }

        @($candidates).Count | Should Be 1
        (@($candidates) -join '') | Should Be 'DESKTOP-88DQ68K\stick'
    }

    It 'reports ambiguity from multiple explorer owners' {
        $owners = @(
            [pscustomobject]@{ ReturnValue = 0; Domain = 'DESKTOP-88DQ68K'; User = 'stick' },
            [pscustomobject]@{ ReturnValue = 0; Domain = 'DESKTOP-88DQ68K'; User = 'other' }
        )
        $script:FieldOpsTestOwnerIndex = 0
        $candidates = Get-FieldOpsInteractiveOperatorCandidates `
            -ComputerSystemProvider { [pscustomobject]@{ UserName = $null } } `
            -ExplorerProvider { @([pscustomobject]@{ ProcessId = 10 }, [pscustomobject]@{ ProcessId = 11 }) } `
            -OwnerResolver { param($Process) $result = $owners[$script:FieldOpsTestOwnerIndex]; $script:FieldOpsTestOwnerIndex++; $result }

        @($candidates).Count | Should Be 2
    }
}

Describe 'FieldOps operator resolution integration invariants' {
    $updaterSource = Get-Content -LiteralPath $updaterPath -Raw
    $installerSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\Install-FieldOpsAgent.ps1') -Raw

    It 'makes OperatorAccount optional in the updater' {
        $updaterSource | Should Match '\[string\]\$OperatorAccount'
        $updaterSource | Should Not Match 'Mandatory = \$true\)\[string\]\$OperatorAccount'
    }

    It 'passes the resolved canonical account to the installer' {
        $updaterSource | Should Match 'Resolve-FieldOpsInteractiveOperator'
        $updaterSource | Should Match ([regex]::Escape("Join-Path `$packageRoot 'agent\scripts\FieldOps.OperatorResolution.psm1'"))
        $updaterSource | Should Match '-OperatorAccount \$OperatorAccount'
        $installerSource | Should Match '\[Parameter\(Mandatory = \$true\)\]\[string\]\$OperatorAccount'
    }

    It 'contains no historical FieldOperator fallback' {
        $updaterSource | Should Not Match '\.\\FieldOperator'
        (Get-Content -LiteralPath $modulePath -Raw) | Should Not Match '\.\\FieldOperator'
    }

    It 'preserves explicit bootstrap-style account syntax' {
        $updaterSource | Should Match '\$OperatorAccount'
        $installerSource | Should Match '-OperatorAccount \$OperatorAccount'
    }
}
