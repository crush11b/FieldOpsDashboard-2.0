Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertTo-FieldOpsBackupCanonicalPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return ([IO.Path]::GetFullPath($Path)).TrimEnd('\', '/')
}

function Test-FieldOpsBackupPathExcluded {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string[]]$ExcludedPaths
    )

    $canonicalPath = ConvertTo-FieldOpsBackupCanonicalPath $Path
    foreach ($excludedPath in @($ExcludedPaths)) {
        if (-not [string]::IsNullOrWhiteSpace($excludedPath) -and
            $canonicalPath.Equals((ConvertTo-FieldOpsBackupCanonicalPath $excludedPath), [StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

function Get-FieldOpsRecoveryBackups {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ParentPath,
        [Parameter(Mandatory = $true)][string]$InstallName,
        [string[]]$ExcludedPaths
    )

    $parent = ConvertTo-FieldOpsBackupCanonicalPath $ParentPath
    $pattern = '^\.' + [regex]::Escape($InstallName) + '-backup-(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$'
    $backups = @()
    foreach ($candidate in @(Get-ChildItem -LiteralPath $parent -Force -Directory -ErrorAction SilentlyContinue)) {
        if ($candidate.Name -notmatch $pattern) { continue }
        if (([IO.Path]::GetFullPath($candidate.FullName)).TrimEnd('\', '/') -notlike "$parent\*") { continue }
        if (($candidate.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
        if (Test-FieldOpsBackupPathExcluded -Path $candidate.FullName -ExcludedPaths $ExcludedPaths) { continue }
        $backups += $candidate
    }
    return @($backups | Sort-Object @{ Expression = { $_.LastWriteTimeUtc }; Descending = $true }, @{ Expression = { $_.Name }; Descending = $false })
}

function Invoke-FieldOpsRecoveryBackupCleanup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ParentPath,
        [Parameter(Mandatory = $true)][string]$InstallName,
        [Parameter(Mandatory = $true)][string]$CurrentTransactionBackupPath,
        [string[]]$ExcludedPaths,
        [int]$RetainCount = 2,
        [scriptblock]$RemoveProvider = { param($Path) Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop },
        [switch]$CleanupCurrentTransactionBackup
    )

    if ($RetainCount -lt 0) { throw 'RetainCount must not be negative.' }
    $activeExclusions = @($ExcludedPaths) + @($CurrentTransactionBackupPath)
    $candidates = @(Get-FieldOpsRecoveryBackups -ParentPath $ParentPath -InstallName $InstallName -ExcludedPaths $activeExclusions)
    $currentCandidates = @(Get-FieldOpsRecoveryBackups -ParentPath $ParentPath -InstallName $InstallName -ExcludedPaths $ExcludedPaths | Where-Object {
        $_.FullName.Equals($CurrentTransactionBackupPath, [StringComparison]::OrdinalIgnoreCase)
    })
    $retained = @($candidates | Select-Object -First $RetainCount)
    $removable = @($candidates | Select-Object -Skip $RetainCount)
    $removed = 0
    $failures = @()

    if ($CleanupCurrentTransactionBackup -and (Test-Path -LiteralPath $CurrentTransactionBackupPath -PathType Container)) {
        try {
            if ($currentCandidates.Count -ne 1) { throw 'Current transaction backup is not a valid updater-owned recovery directory.' }
            & $RemoveProvider (ConvertTo-FieldOpsBackupCanonicalPath $CurrentTransactionBackupPath)
            $removed++
        } catch {
            $failures += [pscustomobject]@{ Name = (Split-Path -Leaf $CurrentTransactionBackupPath); Detail = $_.Exception.Message }
        }
    }

    foreach ($candidate in $removable) {
        try {
            & $RemoveProvider (ConvertTo-FieldOpsBackupCanonicalPath $candidate.FullName)
            $removed++
        } catch {
            $failures += [pscustomobject]@{ Name = $candidate.Name; Detail = $_.Exception.Message }
        }
    }

    return [pscustomobject]@{
        RetainedCount = $retained.Count
        RemovedCount = $removed
        Failures = @($failures)
    }
}

Export-ModuleMember -Function Get-FieldOpsRecoveryBackups, Invoke-FieldOpsRecoveryBackupCleanup