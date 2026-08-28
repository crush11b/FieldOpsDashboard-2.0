[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PackagePath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$SourceRevision,
    [Parameter(Mandatory = $true)][string]$Repository
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$revision = $SourceRevision.ToLowerInvariant()
$tag = "native-$revision"
$packageHash = (Get-FileHash -LiteralPath $PackagePath -Algorithm SHA256).Hash.ToLowerInvariant()

function Invoke-GhApi {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $result = & gh api @Arguments
    if ($LASTEXITCODE -ne 0) { throw "GitHub API request failed: gh api $($Arguments -join ' ')" }
    return ($result | Out-String | ConvertFrom-Json)
}

function Assert-ExistingRelease {
    $ref = Invoke-GhApi @("repos/$Repository/git/ref/tags/$tag")
    if ($ref.object.sha -ne $revision -or $ref.object.type -ne 'commit') {
        throw "Immutable tag '$tag' does not point to source revision '$revision'."
    }

    $release = Invoke-GhApi @("repos/$Repository/releases/tags/$tag")
    $asset = @($release.assets | Where-Object name -eq 'fieldops-native-win-x64.zip')
    if ($asset.Count -ne 1) { throw "Immutable release '$tag' does not contain exactly one expected native asset." }
    if ($asset[0].digest -and $asset[0].digest -ne "sha256:$packageHash") {
        throw "Existing immutable asset '$tag/fieldops-native-win-x64.zip' has different content."
    }
    if (-not $asset[0].digest) {
        $downloadRoot = Join-Path ([IO.Path]::GetTempPath()) "fieldops-native-release-$revision"
        if (Test-Path -LiteralPath $downloadRoot) { Remove-Item -LiteralPath $downloadRoot -Recurse -Force }
        New-Item -ItemType Directory -Path $downloadRoot | Out-Null
        try {
            & gh release download $tag --repo $Repository --pattern 'fieldops-native-win-x64.zip' --dir $downloadRoot --clobber
            if ($LASTEXITCODE -ne 0) { throw "Could not download existing immutable asset '$tag'." }
            $existingHash = (Get-FileHash -LiteralPath (Join-Path $downloadRoot 'fieldops-native-win-x64.zip') -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($existingHash -ne $packageHash) { throw "Existing immutable asset '$tag/fieldops-native-win-x64.zip' has different content." }
        } finally {
            if (Test-Path -LiteralPath $downloadRoot) { Remove-Item -LiteralPath $downloadRoot -Recurse -Force }
        }
    }
    Write-Host "Immutable native release '$tag' already matches source revision and package content."
}

try {
    Assert-ExistingRelease
    exit 0
} catch {
    $message = $_.Exception.Message
    if ($message -notmatch "GitHub API request failed") { throw }
}

$createArgs = @(
    'release', 'create', $tag, $PackagePath, '--repo', $Repository, '--target', $revision,
    '--title', "Native artifact $revision", '--notes', "Immutable native artifact for source revision $revision.", '--prerelease'
)
& gh @createArgs
if ($LASTEXITCODE -eq 0) { Write-Host "Published immutable native release '$tag'."; exit 0 }

# Another workflow may have created the same immutable release between the check and create.
for ($attempt = 0; $attempt -lt 10; $attempt++) {
    try { Assert-ExistingRelease; exit 0 } catch { if ($attempt -eq 9) { throw } }
    Start-Sleep -Seconds 2
}