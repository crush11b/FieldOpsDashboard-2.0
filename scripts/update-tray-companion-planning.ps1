[CmdletBinding()]
param(
    [string]$RepositoryRoot
)

<#
.SYNOPSIS
Applies the reviewed Task 2.3-03 roadmap/backlog reconciliation to known DOCX table rows.

.DESCRIPTION
This planning-maintenance tool stages all required DOCX files, validates every expected task row,
checks the resulting packages, and replaces the originals only after every update succeeds. It is
idempotent and does not perform broad document-wide replacement. RepositoryRoot exists so the
same two-pass behavior can be validated safely against copied planning documents.
#>

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

$wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
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
$stageRoot = Join-Path $repositoryRoot ('.planning-update-{0}' -f [Guid]::NewGuid().ToString('N'))
$documentRoot = $stageRoot

function Get-CellText {
    param(
        [System.Xml.XmlElement]$Cell,
        [System.Xml.XmlNamespaceManager]$NamespaceManager
    )

    return (($Cell.SelectNodes('.//w:t', $NamespaceManager) | ForEach-Object { $_.InnerText }) -join '').Trim()
}

function Set-CellText {
    param(
        [System.Xml.XmlDocument]$Document,
        [System.Xml.XmlElement]$Cell,
        [string]$Text
    )

    $cellProperties = $Cell.SelectSingleNode('./*[local-name()="tcPr"]')
    while ($Cell.HasChildNodes) {
        [void]$Cell.RemoveChild($Cell.FirstChild)
    }

    if ($null -ne $cellProperties) {
        [void]$Cell.AppendChild($cellProperties)
    }

    $paragraph = $Document.CreateElement('w', 'p', $wordNamespace)
    $run = $Document.CreateElement('w', 'r', $wordNamespace)
    $textNode = $Document.CreateElement('w', 't', $wordNamespace)
    $textNode.InnerText = $Text
    [void]$run.AppendChild($textNode)
    [void]$paragraph.AppendChild($run)
    [void]$Cell.AppendChild($paragraph)
}

function Set-TaskRow {
    param(
        [System.Xml.XmlDocument]$Document,
        [System.Xml.XmlNamespaceManager]$NamespaceManager,
        [string]$TaskId,
        [hashtable]$Columns
    )

    $candidateIds = @($TaskId)
    if ($Columns.ContainsKey(0)) {
        $candidateIds += [string]$Columns[0]
    }

    $matched = $false
    foreach ($row in $Document.SelectNodes('//w:tr', $NamespaceManager)) {
        $cells = @($row.SelectNodes('./w:tc', $NamespaceManager))
        if ($cells.Count -eq 0 -or (Get-CellText $cells[0] $NamespaceManager) -notin $candidateIds) {
            continue
        }

        foreach ($column in $Columns.GetEnumerator()) {
            if ($column.Key -ge $cells.Count) {
                throw "Task '$TaskId' does not contain column $($column.Key)."
            }

            Set-CellText $Document $cells[$column.Key] $column.Value
        }

        $matched = $true
        break
    }

    if (-not $matched) {
        throw "Task row '$TaskId' was not found."
    }
}

function Update-Docx {
    param(
        [string]$RelativePath,
        [scriptblock]$Update
    )

    $path = Join-Path $documentRoot $RelativePath
    $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite)
    try {
        $archive = [System.IO.Compression.ZipArchive]::new(
            $stream,
            [System.IO.Compression.ZipArchiveMode]::Update,
            $false)
        try {
            $entry = $archive.GetEntry('word/document.xml')
            if ($null -eq $entry) {
                throw "word/document.xml is missing from '$RelativePath'."
            }

            $reader = [System.IO.StreamReader]::new($entry.Open())
            try {
                $document = [System.Xml.XmlDocument]::new()
                $document.PreserveWhitespace = $true
                $document.LoadXml($reader.ReadToEnd())
            }
            finally {
                $reader.Dispose()
            }

            $namespaceManager = [System.Xml.XmlNamespaceManager]::new($document.NameTable)
            $namespaceManager.AddNamespace('w', $wordNamespace)
            $before = $document.OuterXml
            & $Update $document $namespaceManager
            if ($document.OuterXml -eq $before) {
                return
            }

            $entry.Delete()
            $replacement = $archive.CreateEntry(
                'word/document.xml',
                [System.IO.Compression.CompressionLevel]::Optimal)
            $writerSettings = [System.Xml.XmlWriterSettings]::new()
            $writerSettings.Encoding = [System.Text.UTF8Encoding]::new($false)
            $writerSettings.Indent = $false
            $writer = [System.Xml.XmlWriter]::Create($replacement.Open(), $writerSettings)
            try {
                $document.Save($writer)
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
}

try {
    foreach ($relativePath in $planningDocuments) {
        $source = Join-Path $repositoryRoot $relativePath
        if (-not [System.IO.File]::Exists($source)) {
            throw "Required planning document '$relativePath' is missing."
        }

        $staged = Join-Path $stageRoot $relativePath
        [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($staged)) | Out-Null
        [System.IO.File]::Copy($source, $staged, $false)
    }

Update-Docx 'docs/planning/Engineering_Backlog_v1.0_Part_1_Project_Foundation.docx' {
    param($document, $namespaceManager)

    Set-TaskRow $document $namespaceManager 'E2-001' @{
        0 = '2.3-01'
        1 = 'Technology Spike'
        4 = 'Complete — ADR-001 and ADR-002 accepted; service and transport prototypes validated.'
    }
    Set-TaskRow $document $namespaceManager 'E2-002' @{
        0 = '2.3-02'
        1 = 'Windows Service Skeleton'
        4 = 'Implementation complete; representative ToughPad/ToughBook hardware validation pending.'
    }
    Set-TaskRow $document $namespaceManager 'E2-003' @{
        0 = '2.3-03'
        1 = 'Tray Companion'
        4 = 'Partially implemented — ADR-003 and the disposable prototype are implemented. Native health-client provisioning and real multi-identity ACL validation are active prerequisites. Production UI, packaging, startup, and hardware validation remain incomplete. Telemetry remains dormant and outside scope.'
    }
    Set-TaskRow $document $namespaceManager 'E2-004' @{
        0 = '2.3-04'
        1 = 'Secure Local API'
        4 = 'Partially implemented — authenticated loopback health exists; complete schema, rate, origin, and privileged-operation controls remain.'
    }
    Set-TaskRow $document $namespaceManager 'E2-005' @{
        0 = '2.3-05'
        1 = 'SQLite Foundation'
        4 = 'Not started.'
    }
    Set-TaskRow $document $namespaceManager 'E2-006' @{
        0 = '2.3-06'
        1 = 'Agent Capability Registry'
        4 = 'Not started.'
    }
    Set-TaskRow $document $namespaceManager 'E2-007' @{
        0 = '2.3-07'
        1 = 'Serial-port Enumeration'
        4 = 'Not started.'
    }
    Set-TaskRow $document $namespaceManager 'E2-008' @{
        0 = '2.3-08'
        1 = 'NMEA GNSS Adapter'
        4 = 'Not started.'
    }
    Set-TaskRow $document $namespaceManager 'E2-009' @{
        0 = '2.3-09'
        1 = 'Windows System Telemetry'
        4 = 'Not started — use Windows-provided battery runtime estimates; improve authoritative AC/battery power-source reporting; validate collection runtime on supported hardware.'
    }
    Set-TaskRow $document $namespaceManager 'E2-010' @{
        0 = '2.3-10'
        1 = 'Agent Diagnostics'
        4 = 'Partially implemented — lifecycle logging and health exist; structured adapter diagnostics and redacted export remain.'
    }

    foreach ($paragraph in $document.SelectNodes('//w:p', $namespaceManager)) {
        $text = (($paragraph.SelectNodes('.//w:t', $namespaceManager) | ForEach-Object { $_.InnerText }) -join '').Trim()
        if ($text -eq 'Windows service/tray application providing trusted local data.') {
            $textNode = $paragraph.SelectSingleNode('.//w:t', $namespaceManager)
            $textNode.InnerText = 'Roadmap tasks 2.3-01 through 2.3-10 define the Local Agent sequence. Dormant telemetry transport was implemented before Version 2.2.0; it is not Tray Companion functionality, is not registered for production execution, and must not be activated by Task 2.3-03.'
            break
        }
    }
}

Update-Docx 'docs/planning/Engineering_Backlog_v1.0_Part_2_Core_Platform.docx' {
    param($document, $namespaceManager)

    Set-TaskRow $document $namespaceManager 'E4-008' @{
        5 = 'Future work — define source-specific polling intervals from upstream cadence, rate limits, cache freshness, failure behavior, battery cost, and field-network constraints; test independently.'
    }
    Set-TaskRow $document $namespaceManager 'E5-001' @{
        5 = 'Future work — use Windows-provided battery runtime estimates, improve authoritative AC/battery power-source reporting, retain nullable unsupported fields, and measure runtime on supported Windows hardware.'
    }
}

Update-Docx 'docs/planning/Engineering_Backlog_v1.0_Part_3_Advanced_Capabilities.docx' {
    param($document, $namespaceManager)

    Set-TaskRow $document $namespaceManager 'E8-006' @{
        6 = 'Future work — replace KC2G HTML scraping with the supported stations.json source and expose authoritative ionosonde measurement timestamps rather than request time.'
    }
    Set-TaskRow $document $namespaceManager 'E8-009' @{
        6 = 'Future work — use source-specific polling and cache intervals based on upstream cadence, rate limits, freshness, failure behavior, battery cost, and field-network constraints.'
    }
}

Update-Docx 'docs/planning/FieldOpsDashboard_Development_Roadmap_v1.0.docx' {
    param($document, $namespaceManager)

    Set-TaskRow $document $namespaceManager '2.3-03' @{
        2 = 'ADR-003 selects the tray technology and service-control authorization. Tray shows actual service state and authenticated health, requests a narrowly scoped restart, and reports genuine results.'
    }
    Set-TaskRow $document $namespaceManager '2.3-09' @{
        2 = 'Real battery, CPU, memory, storage, and network information with nullable capability fields. Use Windows-provided battery runtime estimates, authoritative AC/battery source reporting, and supported-hardware runtime measurements.'
    }
    Set-TaskRow $document $namespaceManager '2.4-07' @{
        2 = 'Scheduled retrieval, last-known-good cache, rate handling, service status, source timestamps, and source-specific polling intervals based on upstream cadence and field constraints.'
    }
    Set-TaskRow $document $namespaceManager '2.4-08' @{
        2 = 'Real SWPC indices and ionosonde observations, including KC2G stations.json and authoritative measurement timestamps, with cache policy, source-specific polling, and measured/derived separation.'
    }
}

    foreach ($relativePath in $planningDocuments) {
        $staged = Join-Path $stageRoot $relativePath
        $archive = [System.IO.Compression.ZipFile]::OpenRead($staged)
        try {
            if ($null -eq $archive.GetEntry('word/document.xml')) {
                throw "Updated planning document '$relativePath' is not a valid DOCX package."
            }
        }
        finally {
            $archive.Dispose()
        }
    }

    foreach ($relativePath in $planningDocuments) {
        [System.IO.File]::Copy(
            (Join-Path $stageRoot $relativePath),
            (Join-Path $repositoryRoot $relativePath),
            $true)
    }

    Write-Output 'Updated authoritative planning documents for Task 2.3-03.'
}
finally {
    $resolvedStage = [System.IO.Path]::GetFullPath($stageRoot)
    $expectedPrefix = $repositoryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
        [System.IO.Path]::DirectorySeparatorChar + '.planning-update-'
    if ($resolvedStage.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
        [System.IO.Directory]::Exists($resolvedStage)) {
        [System.IO.Directory]::Delete($resolvedStage, $true)
    }
}
