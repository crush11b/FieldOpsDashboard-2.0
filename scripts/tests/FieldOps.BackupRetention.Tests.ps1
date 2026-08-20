$modulePath = Join-Path $PSScriptRoot '..\FieldOps.BackupRetention.psm1'
$updaterPath = Join-Path $PSScriptRoot '..\..\UpdateDashboard.ps1'
Import-Module $modulePath -Force

Describe 'FieldOps recovery backup retention' {
    BeforeEach {
        $script:parent = Join-Path $TestDrive 'install-parent'
        if (Test-Path -LiteralPath $script:parent) { Remove-Item -LiteralPath $script:parent -Recurse -Force }
        New-Item -ItemType Directory -Path $script:parent -Force | Out-Null
        $script:installName = 'FieldOpsDashboard'
    }

    It 'accepts only exact updater backup names' {
        New-Item -ItemType Directory -Path (Join-Path $script:parent '.FieldOpsDashboard-backup-11111111111111111111111111111111') | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $script:parent '.FieldOpsDashboard-backup-not-a-guid') | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $script:parent '.OtherDashboard-backup-22222222222222222222222222222222') | Out-Null
        (Get-FieldOpsRecoveryBackups -ParentPath $script:parent -InstallName $script:installName).Count | Should Be 1
    }

    It 'preserves filesystem root canonicalization and root child boundaries' {
        InModuleScope FieldOps.BackupRetention {
            $root = ConvertTo-FieldOpsBackupCanonicalPath 'C:\'
            $root | Should Be 'C:\'
            (ConvertTo-FieldOpsBackupCanonicalPath 'C:\FieldOpsDashboard\') | Should Be 'C:\FieldOpsDashboard'
            (Test-FieldOpsBackupPathWithinParent -ChildPath 'C:\.FieldOpsDashboard-backup-81894d0e28df459da339897404b2db9f' -ParentPath $root) | Should Be $true
            (Test-FieldOpsBackupPathWithinParent -ChildPath 'C:\Other\.FieldOpsDashboard-backup-81894d0e28df459da339897404b2db9f' -ParentPath $root) | Should Be $true
        }
    }

    It 'discovers field-shaped root backups through a non-destructive Windows root provider seam' {
        $rootCandidates = @(
            [pscustomobject]@{ Name = '.FieldOpsDashboard-backup-81894d0e28df459da339897404b2db9f'; FullName = 'C:\.FieldOpsDashboard-backup-81894d0e28df459da339897404b2db9f'; Attributes = [IO.FileAttributes]::Directory; LastWriteTimeUtc = [DateTime]::UtcNow },
            [pscustomobject]@{ Name = '.FieldOpsDashboard-backup-11111111111111111111111111111111'; FullName = 'C:\.FieldOpsDashboard-backup-11111111111111111111111111111111'; Attributes = [IO.FileAttributes]::Directory; LastWriteTimeUtc = [DateTime]::UtcNow.AddMinutes(-1) },
            [pscustomobject]@{ Name = '.FieldOpsDashboard-backup-22222222222222222222222222222222'; FullName = 'C:\.FieldOpsDashboard-backup-22222222222222222222222222222222'; Attributes = [IO.FileAttributes]::Directory; LastWriteTimeUtc = [DateTime]::UtcNow.AddMinutes(-2) }
        )
        $backups = @(Get-FieldOpsRecoveryBackups -ParentPath 'C:\' -InstallName $script:installName -ChildItemProvider { param($Path) $rootCandidates })
        $backups.Count | Should Be 3
        ($backups.Name -contains '.FieldOpsDashboard-backup-81894d0e28df459da339897404b2db9f') | Should Be $true
    }

    It 'preserves root semantics in a Windows PowerShell 5.1 subprocess' {
        $powershell = Get-Command powershell.exe -ErrorAction Stop
        $module = (Resolve-Path $modulePath).Path
        $command = "`$module = Import-Module '$module' -Force -PassThru; `$root = & `$module { ConvertTo-FieldOpsBackupCanonicalPath 'C:\' }; if (`$root -cne 'C:\') { throw ('Expected C:\, got ' + `$root) }; 'root-ok'"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $output = & $powershell.Source -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded 2>&1
        $LASTEXITCODE | Should Be 0
        ($output -join "`n") | Should Match 'root-ok'
    }

    It 'rejects backups outside the expected parent' {
        $outside = Join-Path $TestDrive '.FieldOpsDashboard-backup-11111111111111111111111111111111'
        New-Item -ItemType Directory -Path $outside | Out-Null
        (Get-FieldOpsRecoveryBackups -ParentPath $script:parent -InstallName $script:installName).Count | Should Be 0
    }

    It 'never deletes the current transaction backup unless explicitly completed' {
        $current = Join-Path $script:parent '.FieldOpsDashboard-backup-11111111111111111111111111111111'
        New-Item -ItemType Directory -Path $current | Out-Null
        $result = Invoke-FieldOpsRecoveryBackupCleanup -ParentPath $script:parent -InstallName $script:installName -CurrentTransactionBackupPath $current
        Test-Path -LiteralPath $current | Should Be $true
        $result.RemovedCount | Should Be 0
    }

    It 'retains the newest two older backups and removes older valid backups deterministically' {
        $names = @('11111111111111111111111111111111', '22222222222222222222222222222222', '33333333333333333333333333333333')
        $paths = @()
        for ($index = 0; $index -lt $names.Count; $index++) {
            $path = Join-Path $script:parent ('.FieldOpsDashboard-backup-' + $names[$index])
            New-Item -ItemType Directory -Path $path | Out-Null
            [IO.Directory]::SetLastWriteTimeUtc($path, [DateTime]::UtcNow.AddMinutes(-$index))
            $paths += $path
        }
        $result = Invoke-FieldOpsRecoveryBackupCleanup -ParentPath $script:parent -InstallName $script:installName -CurrentTransactionBackupPath (Join-Path $script:parent '.FieldOpsDashboard-backup-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        $result.RetainedCount | Should Be 2
        $result.RemovedCount | Should Be 1
        (Test-Path -LiteralPath $paths[0]) | Should Be $true
        (Test-Path -LiteralPath $paths[1]) | Should Be $true
        (Test-Path -LiteralPath $paths[2]) | Should Be $false
    }

    It 'recognizes and removes the field-shaped current transaction backup' {
        $currentName = '.FieldOpsDashboard-backup-839aae7291d649738df10e27cf1cbc60'
        $current = Join-Path $script:parent $currentName
        New-Item -ItemType Directory -Path $current | Out-Null
        $historical = @()
        for ($index = 1; $index -le 3; $index++) {
            $path = Join-Path $script:parent ('.FieldOpsDashboard-backup-' + ('{0:x32}' -f $index))
            New-Item -ItemType Directory -Path $path | Out-Null
            [IO.Directory]::SetLastWriteTimeUtc($path, [DateTime]::UtcNow.AddMinutes(-$index))
            $historical += $path
        }

        $backups = @(Get-FieldOpsRecoveryBackups -ParentPath ($script:parent + '\') -InstallName $script:installName)
        ($backups.Name -contains $currentName) | Should Be $true
        $result = Invoke-FieldOpsRecoveryBackupCleanup `
            -ParentPath ($script:parent + '\') `
            -InstallName $script:installName `
            -CurrentTransactionBackupPath ($current + '\.') `
            -CleanupCurrentTransactionBackup

        (Test-Path -LiteralPath $current) | Should Be $false
        $result.RetainedCount | Should Be 2
        $result.RemovedCount | Should Be 2
        (Test-Path -LiteralPath $historical[0]) | Should Be $true
        (Test-Path -LiteralPath $historical[1]) | Should Be $true
        (Test-Path -LiteralPath $historical[2]) | Should Be $false
    }

    It 'does not delete active install, stage, download, or failed paths' {
        $backup = Join-Path $script:parent '.FieldOpsDashboard-backup-11111111111111111111111111111111'
        $active = @($backup, (Join-Path $script:parent 'FieldOpsDashboard'), (Join-Path $script:parent '.FieldOpsDashboard-stage-22222222222222222222222222222222'), (Join-Path $script:parent '.FieldOpsDashboard-failed-33333333333333333333333333333333'))
        foreach ($path in $active) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
        $result = Invoke-FieldOpsRecoveryBackupCleanup -ParentPath $script:parent -InstallName $script:installName -CurrentTransactionBackupPath $backup -ExcludedPaths $active
        foreach ($path in $active) { Test-Path -LiteralPath $path | Should Be $true }
        $result.RemovedCount | Should Be 0
    }

    It 'treats cleanup failures as non-fatal and reports the specific name' {
        $backup = Join-Path $script:parent '.FieldOpsDashboard-backup-11111111111111111111111111111111'
        New-Item -ItemType Directory -Path $backup | Out-Null
        $result = Invoke-FieldOpsRecoveryBackupCleanup -ParentPath $script:parent -InstallName $script:installName -CurrentTransactionBackupPath (Join-Path $script:parent '.FieldOpsDashboard-backup-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') -RemoveProvider { param($Path) throw 'access denied' } -RetainCount 0
        $result.Failures.Count | Should Be 1
        $result.Failures[0].Name | Should Be '.FieldOpsDashboard-backup-11111111111111111111111111111111'
    }

    It 'keeps cleanup after readiness success and out of the failure path' {
        $updater = Get-Content -LiteralPath $updaterPath -Raw
        $cleanupIndex = $updater.IndexOf('Invoke-FieldOpsRecoveryBackupCleanup')
        $successIndex = $updater.IndexOf("if ($readiness.Status -eq 'Passed')")
        $failureIndex = $updater.LastIndexOf("`n} catch {")
        $cleanupIndex | Should BeGreaterThan $successIndex
        $cleanupIndex | Should BeLessThan $failureIndex
        ([regex]::Matches($updater, 'Invoke-FieldOpsRecoveryBackupCleanup')).Count | Should Be 1
    }

    It 'uses concise backup output and stable eight-stage labels without raw objects' {
        $updater = Get-Content -LiteralPath $updaterPath -Raw
        $updater | Should Match 'Recovery backups found:.*cleanup will run after successful deployment'
        $updater | Should Match 'Recovery backups: retained.*removed'
        $updater | Should Match 'Recovery backups: none require cleanup'
        $updater | Should Not Match 'Previous update recovery folders were found.*join'
        foreach ($stage in 1..8) { $updater | Should Match "\[$stage/8\]" }
        $updater | Should Not Match 'Format-Table|Status\s+Service\s+Processes'
    }

    It 'keeps direct-token diagnostics out of the deployed stage' {
        $updater = Get-Content -LiteralPath $updaterPath -Raw
        $updater | Should Match 'diagnosticRelativePaths'
        $updater | Should Match 'Remove-Item -LiteralPath \$diagnosticPath'
    }

    It 'quiesces a newly started runtime before filesystem rollback' {
        $updater = Get-Content -LiteralPath $updaterPath -Raw
        $quiesceIndex = $updater.IndexOf('Quiescing newly started FieldOps runtime')
        $moveIndex = $updater.IndexOf('Move-Item -LiteralPath $resolvedInstallPath -Destination $failedPath')
        $quiesceIndex | Should BeGreaterThan -1
        $quiesceIndex | Should BeLessThan $moveIndex
        $updater | Should Match 'Invoke-FieldOpsRuntimeShutdown'
        $updater | Should Match 'Wait-FieldOpsRuntimeQuiescent'
    }

    It 'does not attempt filesystem rollback when rollback quiescence fails' {
        $updater = Get-Content -LiteralPath $updaterPath -Raw
        $updater | Should Match '\$deploymentStarted -and \$rollbackQuiescenceSucceeded -and \(Test-Path -LiteralPath \$backupPath'
        $updater | Should Match 'filesystem restore was not attempted'
    }

    It 'preserves unrelated Node ownership and retention failure boundaries' {
        $shutdown = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'FieldOps.RuntimeShutdown.Tests.ps1') -Raw
        $shutdown | Should Match 'preserves unrelated Node'
        $updater = Get-Content -LiteralPath $updaterPath -Raw
        $updater | Should Match 'Invoke-FieldOpsRecoveryBackupCleanup'
        $updater | Should Match '\$readiness.Status -eq ''Passed'''
    }

    It 'uses direct Node production startup without npm or cmd wrappers' {
        $updater = Get-Content -LiteralPath $updaterPath -Raw
        $updater | Should Match 'Start-FieldOpsDashboardProcess -DashboardRoot \$resolvedInstallPath'
        $updater | Should Not Match "Start-Process -FilePath 'npm\.cmd' -ArgumentList 'start'"
        $updater | Should Match 'Get-FieldOpsRollbackLockingProcesses'
    }

    It 'parses under Windows PowerShell 5.1' {
        $powershell = Get-Command powershell.exe -ErrorAction Stop
        $module = (Resolve-Path $modulePath).Path
        $command = "Import-Module '$module' -Force; if (`$null -eq (Get-Command Get-FieldOpsRecoveryBackups)) { throw 'backup command unavailable' }; 'backup-ok'"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $output = & $powershell.Source -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded 2>&1
        $LASTEXITCODE | Should Be 0
        ($output -join "`n") | Should Match 'backup-ok'
    }
}