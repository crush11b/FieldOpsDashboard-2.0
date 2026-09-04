$modulePath = Join-Path $PSScriptRoot '..\FieldOps.Acl.psm1'
Import-Module $modulePath -Force

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
        Set-FieldOpsAcl -Path $path -Acl (New-TestAcl -IsDirectory $true -ReadSid $script:readSid) -IsDirectory $true
        $acl = Get-FieldOpsAcl -Path $path -IsDirectory $true
        $acl.AreAccessRulesProtected | Should Be $true
        $rules = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
        $rules.Count | Should Be 3
        (Get-TestRule -Acl $acl -Sid 'S-1-5-18').FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl | Should Be ([Security.AccessControl.FileSystemRights]::FullControl)
        (Get-TestRule -Acl $acl -Sid 'S-1-5-32-544').FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl | Should Be ([Security.AccessControl.FileSystemRights]::FullControl)
        $localRule = Get-TestRule -Acl $acl -Sid $script:readSid
        ($localRule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadAndExecute) | Should Be ([Security.AccessControl.FileSystemRights]::ReadAndExecute)
        ($localRule.FileSystemRights -band (Get-FieldOpsForbiddenLocalServiceRights -IsDirectory $true)) | Should Be 0
    }

    It 'retrieves and applies a protected file ACL with read-only rights' {
        $path = Join-Path $script:testRoot 'credential.dat'
        [IO.File]::WriteAllText($path, 'test')
        Set-FieldOpsAcl -Path $path -Acl (New-TestAcl -IsDirectory $false -ReadSid $script:readSid) -IsDirectory $false
        $acl = Get-FieldOpsAcl -Path $path -IsDirectory $false
        $acl.AreAccessRulesProtected | Should Be $true
        $rules = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
        $rules.Count | Should Be 3
        $readRule = Get-TestRule -Acl $acl -Sid $script:readSid
        ($readRule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Read) | Should Be ([Security.AccessControl.FileSystemRights]::Read)
        ($readRule.FileSystemRights -band (Get-FieldOpsForbiddenLocalServiceRights -IsDirectory $false)) | Should Be 0
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
