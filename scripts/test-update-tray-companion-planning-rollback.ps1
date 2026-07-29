[CmdletBinding()]
param(
    [string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = Split-Path -Parent $PSScriptRoot
}

$repositoryRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
$planningDocuments = @(
    'docs/planning/Engineering_Backlog_v1.0_Part_1_Project_Foundation.docx',
    'docs/planning/Engineering_Backlog_v1.0_Part_2_Core_Platform.docx',
    'docs/planning/Engineering_Backlog_v1.0_Part_3_Advanced_Capabilities.docx',
    'docs/planning/FieldOpsDashboard_Development_Roadmap_v1.0.docx'
)
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('fieldops-planning-rollback-{0}' -f [Guid]::NewGuid().ToString('N'))
$lockedStream = $null

try {
    foreach ($relativePath in $planningDocuments) {
        $destination = Join-Path $testRoot $relativePath
        [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($destination)) | Out-Null
        [System.IO.File]::Copy((Join-Path $repositoryRoot $relativePath), $destination, $false)
    }

    $scriptDestination = Join-Path $testRoot 'scripts/update-tray-companion-planning.ps1'
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($scriptDestination)) | Out-Null
    [System.IO.File]::Copy(
        (Join-Path $repositoryRoot 'scripts/update-tray-companion-planning.ps1'),
        $scriptDestination,
        $false)

    # Force the first document to need an update so a failed third replacement
    # proves that already-replaced files are restored rather than merely unchanged.
    $firstDocument = Join-Path $testRoot $planningDocuments[0]
    $stream = [System.IO.File]::Open($firstDocument, 'Open', 'ReadWrite', 'None')
    try {
        $archive = [System.IO.Compression.ZipArchive]::new($stream, 'Update', $false)
        try {
            $entry = $archive.GetEntry('word/document.xml')
            $reader = [System.IO.StreamReader]::new($entry.Open())
            try {
                $xml = $reader.ReadToEnd()
            }
            finally {
                $reader.Dispose()
            }

            $changed = $xml.Replace('2.3-01', 'E2-001')
            if ($changed -eq $xml) {
                throw 'The rollback fixture could not locate task 2.3-01.'
            }

            $entry.Delete()
            $replacement = $archive.CreateEntry('word/document.xml')
            $writer = [System.IO.StreamWriter]::new($replacement.Open(), [System.Text.UTF8Encoding]::new($false))
            try {
                $writer.Write($changed)
            }
            finally {
                $writer.Dispose()
            }
        }
        finally {
            $archive.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }

    $before = @{}
    foreach ($relativePath in $planningDocuments) {
        $before[$relativePath] = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $testRoot $relativePath)).Hash
    }

    # Reads and staging remain possible, but overwriting the third original fails
    # after the first two replacement operations have completed.
    $lockedPath = Join-Path $testRoot $planningDocuments[2]
    $lockedStream = [System.IO.File]::Open(
        $lockedPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read)

    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $scriptDestination),
        '-RepositoryRoot', ('"{0}"' -f $testRoot)
    ) -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -eq 0) {
        throw 'The planning update unexpectedly succeeded while a destination was write-locked.'
    }

    foreach ($relativePath in $planningDocuments) {
        $after = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $testRoot $relativePath)).Hash
        if ($after -ne $before[$relativePath]) {
            throw "Rollback did not restore '$relativePath'."
        }
    }

    if (Get-ChildItem -LiteralPath $testRoot -Directory -Filter '.planning-update-*') {
        throw 'A successful rollback left a planning staging directory behind.'
    }

    $global:LASTEXITCODE = 0
    Write-Output 'Planning replacement-phase rollback validation passed.'
}
finally {
    if ($null -ne $lockedStream) {
        $lockedStream.Dispose()
    }

    if ([System.IO.Directory]::Exists($testRoot)) {
        [System.IO.Directory]::Delete($testRoot, $true)
    }
}
