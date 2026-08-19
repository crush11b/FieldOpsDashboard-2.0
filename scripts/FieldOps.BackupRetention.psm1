Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertTo-FieldOpsBackupCanonicalPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    $fullPath = [IO.Path]::GetFullPath($Path)
    $pathRoot = [IO.Path]::GetPathRoot($fullPath)
    if ([string]::Equals($fullPath, $pathRoot, [StringComparison]::OrdinalIgnoreCase)) {
        return $pathRoot
    }
    return $fullPath.TrimEnd('\', '/')
}

function Test-FieldOpsBackupPathWithinParent {
    param(
        [Parameter(Mandatory = $true)][string]$ChildPath,
        [Parameter(Mandatory = $true)][string]$ParentPath
    )

    if ([string]::Equals($ParentPath, [IO.Path]::GetPathRoot($ParentPath), [StringComparison]::OrdinalIgnoreCase)) {
        return $ChildPath.StartsWith($ParentPath, [StringComparison]::OrdinalIgnoreCase)
    }
    return $ChildPath.StartsWith($ParentPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
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
        [string[]]$ExcludedPaths,
        [scriptblock]$ChildItemProvider = { param($Path) Get-ChildItem -LiteralPath $Path -Force -Directory -ErrorAction SilentlyContinue }
    )

    $parent = ConvertTo-FieldOpsBackupCanonicalPath $ParentPath
    $pattern = '^\.' + [regex]::Escape($InstallName) + '-backup-(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$'
    $backups = @()
    foreach ($candidate in @(& $ChildItemProvider $parent)) {
        if ($candidate.Name -notmatch $pattern) { continue }
        $candidatePath = ConvertTo-FieldOpsBackupCanonicalPath $candidate.FullName
        if (-not (Test-FieldOpsBackupPathWithinParent -ChildPath $candidatePath -ParentPath $parent)) { continue }
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
    $canonicalCurrentTransactionBackupPath = ConvertTo-FieldOpsBackupCanonicalPath $CurrentTransactionBackupPath
    $currentCandidates = @(Get-FieldOpsRecoveryBackups -ParentPath $ParentPath -InstallName $InstallName -ExcludedPaths $ExcludedPaths | Where-Object {
        (ConvertTo-FieldOpsBackupCanonicalPath $_.FullName).Equals($canonicalCurrentTransactionBackupPath, [StringComparison]::OrdinalIgnoreCase)
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