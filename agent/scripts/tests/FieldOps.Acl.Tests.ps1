$modulePath = Join-Path $PSScriptRoot '..\FieldOps.Acl.psm1'
Import-Module $modulePath -Force

$provisionerPath = Join-Path $PSScriptRoot '..\Provision-FieldOpsTelemetryCredential.ps1'
$provisionerTokens = $null
$provisionerErrors = $null
$provisionerAst = [Management.Automation.Language.Parser]::ParseFile($provisionerPath, [ref]$provisionerTokens, [ref]$provisionerErrors)
foreach ($functionName in @('Set-ProtectedAcl', 'Assert-ProtectedAcl')) {
    $functionAst = $provisionerAst.Find({ param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq $functionName
    }, $true)
    . ([scriptblock]::Create($functionAst.Extent.Text))
}

function New-TestAcl {
    param(
        [Parameter(Mandatory = $true)][bool]$IsDirectory,
        [Parameter(Mandatory = $true)][Security.Principal.SecurityIdentifier]$ReadSid
    )

    $acl = if ($IsDirectory) {
        New-Object Security.AccessControl.DirectorySecurity
    } else {
        New-Object Security.AccessControl.FileSecurity
    }
    $inheritance = if ($IsDirectory) {
        [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    } else {
        [Security.AccessControl.InheritanceFlags]::None
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
    $readRights = if ($IsDirectory) {
        [Security.AccessControl.FileSystemRights]::ReadAndExecute
    } else {
        [Security.AccessControl.FileSystemRights]::Read
    }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        $ReadSid, $readRights, $inheritance, $none, $allow)) | Out-Null
    return $acl
}

function Get-TestRule {
    param(
        [Parameter(Mandatory = $true)]$Acl,
        [Parameter(Mandatory = $true)][string]$Sid
    )
    return @($Acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])) |
        Where-Object { $_.IdentityReference.Value -eq $Sid }
}

Describe 'FieldOps shared filesystem ACL helpers' {
    BeforeEach {
        $script:testRoot = Join-Path ([IO.Path]::GetTempPath()) ('FieldOpsAcl-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:testRoot -Force | Out-Null
        $script:readSid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User
    }

    AfterEach {
        Remove-Item -LiteralPath $script:testRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'retrieves and applies a protected directory ACL with exact rights' {
        $path = Join-Path $script:testRoot 'directory'
        New-Item -ItemType Directory -Path $path | Out-Null
        Set-ProtectedAcl -Path $path -ReadSids @($script:readSid) -IsDirectory $true
        $acl = Get-FieldOpsAcl -Path $path -IsDirectory $true
        $acl.AreAccessRulesProtected | Should Be $true
        $rules = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
        $rules.Count | Should Be 3
        (Get-TestRule -Acl $acl -Sid 'S-1-5-18').FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl | Should Be ([Security.AccessControl.FileSystemRights]::FullControl)
        (Get-TestRule -Acl $acl -Sid 'S-1-5-32-544').FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl | Should Be ([Security.AccessControl.FileSystemRights]::FullControl)
        $localRule = Get-TestRule -Acl $acl -Sid $script:readSid
        ($localRule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadAndExecute) | Should Be ([Security.AccessControl.FileSystemRights]::ReadAndExecute)
        ($localRule.FileSystemRights -band (Get-FieldOpsForbiddenLocalServiceRights -IsDirectory $true)) | Should Be 0
        { Assert-ProtectedAcl -Path $path -AllowedSids @('S-1-5-18', 'S-1-5-32-544', $script:readSid) -IsDirectory $true } | Should Not Throw
    }

    It 'retrieves and applies a protected file ACL with read-only rights' {
        $path = Join-Path $script:testRoot 'credential.dat'
        [IO.File]::WriteAllText($path, 'test')
        Set-ProtectedAcl -Path $path -ReadSids @($script:readSid) -IsDirectory $false
        $acl = Get-FieldOpsAcl -Path $path -IsDirectory $false
        $acl.AreAccessRulesProtected | Should Be $true
        $rules = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
        $rules.Count | Should Be 3
        $readRule = Get-TestRule -Acl $acl -Sid $script:readSid
        ($readRule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Read) | Should Be ([Security.AccessControl.FileSystemRights]::Read)
        ($readRule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ExecuteFile) | Should Be 0
        ($readRule.FileSystemRights -band (Get-FieldOpsForbiddenLocalServiceRights -IsDirectory $false)) | Should Be 0
        { Assert-ProtectedAcl -Path $path -AllowedSids @('S-1-5-18', 'S-1-5-32-544', $script:readSid) -IsDirectory $false } | Should Not Throw
    }

    It 'does not resolve or invoke shadowed PowerShell ACL cmdlets' {
        function global:Get-Acl { throw 'Get-Acl must not be called.' }
        function global:Set-Acl { throw 'Set-Acl must not be called.' }
        try {
            $path = Join-Path $script:testRoot 'shadowed.dat'
            [IO.File]::WriteAllText($path, 'test')
            $acl = New-TestAcl -IsDirectory $false -ReadSid $script:readSid
            Set-FieldOpsAcl -Path $path -Acl $acl -IsDirectory $false
            Get-FieldOpsAcl -Path $path -IsDirectory $false | Should Not Be $null
        } finally {
            Remove-Item Function:\global:Get-Acl -ErrorAction SilentlyContinue
            Remove-Item Function:\global:Set-Acl -ErrorAction SilentlyContinue
        }
    }

    It 'rejects unexpected and excessive LocalService access' {
        $path = Join-Path $script:testRoot 'unsafe.dat'
        [IO.File]::WriteAllText($path, 'test')
        $acl = New-TestAcl -IsDirectory $false -ReadSid ([Security.Principal.SecurityIdentifier]::new('S-1-5-19'))
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new('S-1-5-19'),
            [Security.AccessControl.FileSystemRights]::WriteData,
            [Security.AccessControl.InheritanceFlags]::None,
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow)) | Out-Null
        Set-FieldOpsAcl -Path $path -Acl $acl -IsDirectory $false
        $installerPath = Join-Path $PSScriptRoot '..\Install-FieldOpsAgent.ps1'
        $tokens = $null
        $parseErrors = $null
        $installerAst = [Management.Automation.Language.Parser]::ParseFile($installerPath, [ref]$tokens, [ref]$parseErrors)
        $assertion = $installerAst.Find({ param($node)
            $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
            $node.Name -eq 'Assert-FieldOpsAcl'
        }, $true)
        . ([scriptblock]::Create($assertion.Extent.Text))
        $failedClosed = $false
        try { Assert-FieldOpsAcl -Path $path -IsDirectory $false } catch { $failedClosed = $true }
        $failedClosed | Should Be $true
    }

    It 'rejects execute, write, full-control, unexpected, deny, and duplicate reader entries' {
        $baseCases = @(
            @{ Name = 'execute'; Rights = [Security.AccessControl.FileSystemRights]::ExecuteFile; Sid = $script:readSid; Type = [Security.AccessControl.AccessControlType]::Allow },
            @{ Name = 'write'; Rights = [Security.AccessControl.FileSystemRights]::WriteData; Sid = $script:readSid; Type = [Security.AccessControl.AccessControlType]::Allow },
            @{ Name = 'full control'; Rights = [Security.AccessControl.FileSystemRights]::FullControl; Sid = $script:readSid; Type = [Security.AccessControl.AccessControlType]::Allow },
            @{ Name = 'unexpected SID'; Rights = [Security.AccessControl.FileSystemRights]::Read; Sid = ([Security.Principal.SecurityIdentifier]::new('S-1-5-19')); Type = [Security.AccessControl.AccessControlType]::Allow },
            @{ Name = 'deny'; Rights = [Security.AccessControl.FileSystemRights]::Read; Sid = $script:readSid; Type = [Security.AccessControl.AccessControlType]::Deny }
        )
        foreach ($case in $baseCases) {
            $path = Join-Path $script:testRoot ($case.Name.Replace(' ', '-') + '.dat')
            [IO.File]::WriteAllText($path, 'test')
            Set-ProtectedAcl -Path $path -ReadSids @($script:readSid) -IsDirectory $false
            $acl = Get-FieldOpsAcl -Path $path -IsDirectory $false
            $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
                $case.Sid, $case.Rights, [Security.AccessControl.InheritanceFlags]::None,
                [Security.AccessControl.PropagationFlags]::None, $case.Type)) | Out-Null
            Set-FieldOpsAcl -Path $path -Acl $acl -IsDirectory $false
            $failedClosed = $false
            try { Assert-ProtectedAcl -Path $path -AllowedSids @('S-1-5-18', 'S-1-5-32-544', $script:readSid) -IsDirectory $false } catch { $failedClosed = $true }
            if (-not $failedClosed) { throw "Production ACL assertion accepted unsafe '$($case.Name)' entry." }
        }

        $duplicatePath = Join-Path $script:testRoot 'duplicate.dat'
        [IO.File]::WriteAllText($duplicatePath, 'test')
        Set-ProtectedAcl -Path $duplicatePath -ReadSids @($script:readSid) -IsDirectory $false
        $duplicateAcl = Get-FieldOpsAcl -Path $duplicatePath -IsDirectory $false
        $duplicateRules = @($duplicateAcl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
        $script:duplicateAcl = [pscustomobject]@{ AreAccessRulesProtected = $true }
        $script:duplicateRules = @($duplicateRules) + @($duplicateRules | Where-Object { $_.IdentityReference.Value -eq $script:readSid.Value })
        $script:duplicateAcl | Add-Member -MemberType ScriptMethod -Name GetAccessRules -Value {
            param($IncludeExplicit, $IncludeInherited, $TargetType)
            return $script:duplicateRules
        }
        function global:Get-FieldOpsAcl { return $script:duplicateAcl }
        $failedClosed = $false
        try { Assert-ProtectedAcl -Path $duplicatePath -AllowedSids @('S-1-5-18', 'S-1-5-32-544', $script:readSid) -IsDirectory $false } catch { $failedClosed = $true }
        Remove-Item Function:\global:Get-FieldOpsAcl -ErrorAction SilentlyContinue
        $failedClosed | Should Be $true
    }

    It 'rejects missing required rights for administrative and reader entries' {
        $cases = @(
            @{ Name = 'system-missing'; Sid = 'S-1-5-18'; Rights = [Security.AccessControl.FileSystemRights]::FullControl -bxor [Security.AccessControl.FileSystemRights]::WriteData },
            @{ Name = 'administrators-read'; Sid = 'S-1-5-32-544'; Rights = [Security.AccessControl.FileSystemRights]::Read },
            @{ Name = 'directory-reader-read'; Sid = $script:readSid.Value; Rights = [Security.AccessControl.FileSystemRights]::Read },
            @{ Name = 'file-reader-missing-read'; Sid = $script:readSid.Value; Rights = [Security.AccessControl.FileSystemRights]::ReadData -bxor [Security.AccessControl.FileSystemRights]::ReadAttributes }
        )
        foreach ($case in $cases) {
            $script:missingRightsAcl = [pscustomobject]@{ AreAccessRulesProtected = $true }
            $sid = [Security.Principal.SecurityIdentifier]::new($case.Sid)
            $rule = [Security.AccessControl.FileSystemAccessRule]::new(
                $sid, $case.Rights, [Security.AccessControl.InheritanceFlags]::None,
                [Security.AccessControl.PropagationFlags]::None,
                [Security.AccessControl.AccessControlType]::Allow)
            $script:missingRightsRules = @($rule)
            $script:missingRightsAcl | Add-Member -MemberType ScriptMethod -Name GetAccessRules -Value {
                param($IncludeExplicit, $IncludeInherited, $TargetType)
                return $script:missingRightsRules
            }
            function global:Get-FieldOpsAcl { return $script:missingRightsAcl }
            $failedClosed = $false
            try { Assert-ProtectedAcl -Path 'ignored' -AllowedSids @($case.Sid) -IsDirectory ($case.Name -eq 'directory-reader-read') } catch { $failedClosed = $true }
            Remove-Item Function:\global:Get-FieldOpsAcl -ErrorAction SilentlyContinue
            $failedClosed | Should Be $true
        }
    }

    It 'asserts both credential directories immediately after applying their ACLs' {
        $provisioner = Get-Content $provisionerPath -Raw
        $receiverSet = $provisioner.IndexOf('Set-ProtectedAcl -Path $receiverDirectory', [StringComparison]::Ordinal)
        $receiverAssert = $provisioner.IndexOf('Assert-ProtectedAcl -Path $receiverDirectory', [StringComparison]::Ordinal)
        $agentSet = $provisioner.IndexOf('Set-ProtectedAcl -Path $agentDirectory', [StringComparison]::Ordinal)
        $agentAssert = $provisioner.IndexOf('Assert-ProtectedAcl -Path $agentDirectory', [StringComparison]::Ordinal)
        ($receiverSet -ge 0 -and $receiverAssert -gt $receiverSet -and $agentSet -ge 0 -and $agentAssert -gt $agentSet -and $receiverAssert -lt $agentSet) | Should Be $true
    }

    It 'contains no legacy ACL cmdlets in either deployment path' {
        $installer = Get-Content (Join-Path $PSScriptRoot '..\Install-FieldOpsAgent.ps1') -Raw
        $provisioner = Get-Content (Join-Path $PSScriptRoot '..\Provision-FieldOpsTelemetryCredential.ps1') -Raw
        $installer | Should Not Match '(?m)^\s*\$acl\s*=\s*Get-Acl\b'
        $installer | Should Not Match '(?m)^\s*Set-Acl\b'
        $provisioner | Should Not Match '(?m)^\s*Set-Acl\b'
        $provisioner | Should Not Match '(?m)^\s*\$acl\s*=\s*Get-Acl\b'
        $installer | Should Match 'Get-FieldOpsAcl'
        $provisioner | Should Match 'Set-FieldOpsAcl'
    }
}
