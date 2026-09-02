[CmdletBinding()]
param(
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$Revision,
    [string]$InstallPath = 'C:\FieldOpsDashboard',
    [string]$OperatorAccount = '.\stick',
    [string]$Repository = 'crush11b/FieldOpsDashboard-2.0',
    [string]$Branch = 'feature/2.7-connected-operations'
)

$runAsScript = $MyInvocation.InvocationName -ne '.'

function Assert-Tool {
    param([Parameter(Mandatory = $true)][string]$Name)
    if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name.exe is required for the FieldOps development updater."
    }
}

function Assert-FullSha {
    param([Parameter(Mandatory = $true)][string]$Value, [Parameter(Mandatory = $true)][string]$Description)
    if ($Value -notmatch '^[0-9a-fA-F]{40}$') {
        throw "$Description is not a full 40-character Git commit SHA."
    }
    return $Value.ToLowerInvariant()
}

function Resolve-DevelopmentRevision {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryName,
        [Parameter(Mandatory = $true)][string]$BranchName,
        [string]$ExplicitRevision
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitRevision)) {
        return Assert-FullSha -Value $ExplicitRevision -Description 'Explicit revision'
    }

    $apiUrl = "https://api.github.com/repos/$RepositoryName/commits/$BranchName"
    $body = & curl.exe --fail --silent --show-error --location --connect-timeout 10 --max-time 30 `
        -H 'Accept: application/vnd.github+json' `
        -H 'User-Agent: FieldOpsDashboard-Development-Updater' `
        $apiUrl
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($body -join ''))) {
        throw "Could not resolve development branch '$BranchName' from GitHub."
    }

    try { $response = ($body -join [Environment]::NewLine) | ConvertFrom-Json } catch { throw "GitHub returned invalid JSON while resolving branch '$BranchName'." }
    return Assert-FullSha -Value ([string]$response.sha) -Description "GitHub revision for branch '$BranchName'"
}

function Assert-DownloadedUpdater {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'The exact-revision updater download is missing.' }
    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count -gt 0 -or $null -eq $ast.ParamBlock) { throw 'The downloaded UpdateDashboard.ps1 failed PowerShell parsing.' }
    $parameterNames = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
    foreach ($required in @('Revision', 'OperatorAccount', 'EnableCf20GnssRecovery')) {
        if ($parameterNames -notcontains $required) { throw "The downloaded updater does not declare parameter '$required'." }
    }
}

function Get-DevelopmentBootstrapFiles {
    return @('UpdateDashboard.ps1', 'scripts\FieldOps.BackupRetention.psm1')
}

function Assert-DownloadedPowerShellFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required bootstrap file '$Path' is missing." }
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count -gt 0) { throw "Required bootstrap file '$Path' failed PowerShell parsing." }
}

function Invoke-DevelopmentBootstrapDownload {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryName,
        [Parameter(Mandatory = $true)][string]$ResolvedRevision,
        [Parameter(Mandatory = $true)][string]$BootstrapRoot,
        [scriptblock]$DownloadInvoker = {
            param($Url, $Destination)
            & curl.exe --fail --silent --show-error --location --connect-timeout 10 --max-time 30 --output $Destination $Url
            if ($LASTEXITCODE -ne 0) { throw "Download failed for '$Url'." }
        }
    )

    foreach ($relativePath in Get-DevelopmentBootstrapFiles) {
        $destination = Join-Path $BootstrapRoot $relativePath
        $destinationDirectory = Split-Path -Parent $destination
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        $url = "https://raw.githubusercontent.com/$RepositoryName/$ResolvedRevision/$($relativePath.Replace('\', '/'))"
        & $DownloadInvoker $url $destination
        Assert-DownloadedPowerShellFile -Path $destination
    }
    Assert-DownloadedUpdater -Path (Join-Path $BootstrapRoot 'UpdateDashboard.ps1')
    return @(Get-DevelopmentBootstrapFiles | ForEach-Object { Join-Path $BootstrapRoot $_ })
}

function Get-InstalledVersion {
    param([Parameter(Mandatory = $true)][string]$ExpectedRevision)
    $response = & curl.exe --fail --silent --show-error --location --connect-timeout 5 --max-time 10 http://127.0.0.1:3000/api/version
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($response -join ''))) { throw 'Dashboard /api/version could not be reached after deployment.' }
    try { $version = ($response -join [Environment]::NewLine) | ConvertFrom-Json } catch { throw 'Dashboard /api/version returned invalid JSON.' }
    if ([string]$version.sourceRevision -ne $ExpectedRevision) { throw "Dashboard sourceRevision '$($version.sourceRevision)' does not match expected revision '$ExpectedRevision'." }
    if ([string]$version.nativeRevision -ne $ExpectedRevision) { throw "Dashboard nativeRevision '$($version.nativeRevision)' does not match expected revision '$ExpectedRevision'." }
    return $version
}

function Write-Failure {
    param([Parameter(Mandatory = $true)]$ErrorRecord)
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Red
    Write-Host ' FIELDOPS DEVELOPMENT UPDATE FAILED' -ForegroundColor Red
    Write-Host '============================================================' -ForegroundColor Red
    Write-Host $ErrorRecord.Exception.Message -ForegroundColor Red
}

if (-not $runAsScript) { return }

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$tempRoot = Join-Path $env:TEMP ('FieldOpsDevelopmentUpdater-' + [Guid]::NewGuid().ToString('N'))
$downloadedUpdater = Join-Path $tempRoot 'UpdateDashboard.ps1'
$sourceDescription = 'Explicit revision'
try {
    if (-not (Test-Path -LiteralPath $InstallPath -PathType Container)) { throw "APP_DIR '$InstallPath' does not exist." }
    Assert-Tool -Name 'curl'
    Assert-Tool -Name 'powershell'
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

    $resolvedRevision = Resolve-DevelopmentRevision -RepositoryName $Repository -BranchName $Branch -ExplicitRevision $Revision
    if ([string]::IsNullOrWhiteSpace($Revision)) { $sourceDescription = "Development branch '$Branch'" }
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host ' FIELDOPS DEVELOPMENT UPDATE' -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host "Branch:              $Branch"
    Write-Host "Resolved revision:   $resolvedRevision"
    Write-Host "Source:              $sourceDescription"
    Write-Host '============================================================' -ForegroundColor Cyan
    $confirmation = Read-Host 'Deploy this revision? [Y/N]'
    if ($confirmation -notmatch '^(?i:y|yes)$') { throw 'Deployment cancelled by operator.' }

    $bootstrapFiles = Invoke-DevelopmentBootstrapDownload -RepositoryName $Repository -ResolvedRevision $resolvedRevision -BootstrapRoot $tempRoot
    $downloadedUpdater = $bootstrapFiles[0]
    Write-Host "[OK] Validated exact-revision bootstrap set ($($bootstrapFiles.Count) files)." -ForegroundColor Green

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $downloadedUpdater `
        -InstallPath $InstallPath -OperatorAccount $OperatorAccount -Repository $Repository -Revision $resolvedRevision `
        -NativeArtifactUrl "https://github.com/$Repository/releases/download/native-$resolvedRevision/fieldops-native-win-x64.zip" `
        -EnableCf20GnssRecovery
    if ($LASTEXITCODE -ne 0) { throw "UpdateDashboard.ps1 failed with exit code $LASTEXITCODE." }

    $version = Get-InstalledVersion -ExpectedRevision $resolvedRevision
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host ' FIELDOPS DEVELOPMENT UPDATE VERIFIED' -ForegroundColor Green
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host "Branch:              $Branch"
    Write-Host "Revision:            $resolvedRevision"
    Write-Host "Source:              $sourceDescription"
    Write-Host 'Source revision:     MATCHED' -ForegroundColor Green
    Write-Host 'Native revision:     MATCHED' -ForegroundColor Green
    Write-Host "Version:             $($version.informationalVersion)"
    Write-Host 'Dashboard:           RUNNING' -ForegroundColor Green
    Write-Host '============================================================' -ForegroundColor Green
    exit 0
} catch {
    Write-Failure -ErrorRecord $_
    exit 1
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
