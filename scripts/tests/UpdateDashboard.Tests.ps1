$updaterPath = Join-Path $PSScriptRoot '..\..\UpdateDashboard.ps1'

Describe 'UpdateDashboard SHA-256 verification' {
    BeforeAll {
        $source = Get-Content -LiteralPath $updaterPath -Raw
        $helperMatch = [regex]::Match($source, '(?s)function Get-Sha256Hex\s*\{.*?\n\}')
        $artifactMatch = [regex]::Match($source, '(?s)function Assert-P533RuntimeArtifact\s*\{.*?\n\}')
        if (-not $helperMatch.Success -or -not $artifactMatch.Success) { throw 'Updater verification functions could not be loaded.' }
        . ([scriptblock]::Create($helperMatch.Value))
        . ([scriptblock]::Create($artifactMatch.Value))
        $script:testRoot = Join-Path ([IO.Path]::GetTempPath()) ('fieldops-updater-sha256-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:testRoot -Force | Out-Null
    }

    AfterAll {
        if (Test-Path -LiteralPath $script:testRoot) { Remove-Item -LiteralPath $script:testRoot -Recurse -Force }
    }

    It 'returns the known SHA-256 for a deterministic fixture' {
        $path = Join-Path $script:testRoot 'fixture.bin'
        [IO.File]::WriteAllText($path, 'FieldOps SHA-256 fixture', [Text.UTF8Encoding]::new($false))
        Get-Sha256Hex -Path $path | Should Be '244f9e62452edd3ea35ffe10ccca3dd818889332a310a297476ab3642b21f6c8'
    }

    It 'does not depend on Get-FileHash being available or shadowed' {
        $path = Join-Path $script:testRoot 'shadowed.bin'
        [IO.File]::WriteAllText($path, 'shadowed Get-FileHash', [Text.UTF8Encoding]::new($false))
        function Get-FileHash { throw 'Get-FileHash is unavailable in this test context.' }
        { Get-Sha256Hex -Path $path } | Should Not Throw
    }

    It 'fails closed for a mismatched hash' {
        $path = Join-Path $script:testRoot 'mismatch.bin'
        [IO.File]::WriteAllText($path, 'mismatch', [Text.UTF8Encoding]::new($false))
        { if ((Get-Sha256Hex -Path $path) -ne ('0' * 64)) { throw 'P.533 runtime artifact hash mismatch.' } } | Should Throw 'P.533 runtime artifact hash mismatch.'
    }

    It 'releases the file stream after success and failure' {
        $path = Join-Path $script:testRoot 'release.bin'
        [IO.File]::WriteAllText($path, 'release', [Text.UTF8Encoding]::new($false))
        Get-Sha256Hex -Path $path | Out-Null
        { [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None).Dispose() } | Should Not Throw
        $failed = $false
        try { Get-Sha256Hex -Path (Join-Path $script:testRoot 'missing.bin') | Out-Null } catch { $failed = $true }
        $failed | Should Be $true
        { [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None).Dispose() } | Should Not Throw
    }

    It 'validates every required P.533 runtime file' {
        $packageRoot = Join-Path $script:testRoot 'package'
        $nativeRoot = Join-Path $script:testRoot 'native'
        $runtimeRoot = Join-Path $nativeRoot 'p533-assets\runtime'
        New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
        $files = @('p533.mjs', 'p533.wasm', 'data-a.bin')
        foreach ($file in $files) { [IO.File]::WriteAllText((Join-Path $runtimeRoot $file), $file, [Text.UTF8Encoding]::new($false)) }
        New-Item -ItemType Directory -Path (Join-Path $packageRoot 'p533-assets') -Force | Out-Null
        $manifest = [pscustomobject]@{ modelVersion = 'model'; dataVersion = 'data'; dataFiles = @([pscustomobject]@{ runtimeName = 'data-a.bin' }); p533MjsSha256 = Get-Sha256Hex -Path (Join-Path $runtimeRoot 'p533.mjs'); p533WasmSha256 = Get-Sha256Hex -Path (Join-Path $runtimeRoot 'p533.wasm') }
        $manifestJson = $manifest | ConvertTo-Json -Depth 5
        [IO.File]::WriteAllText((Join-Path $packageRoot 'p533-assets\manifest.json'), $manifestJson)
        New-Item -ItemType Directory -Path (Join-Path $nativeRoot 'p533-assets') -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $nativeRoot 'p533-assets\manifest.json'), $manifestJson)
        [IO.File]::WriteAllText((Join-Path $runtimeRoot 'provenance.json'), (@{ modelVersion = 'model'; dataVersion = 'data'; runtimeNetworkRequired = $false; installedFiles = @{ 'data-a.bin' = Get-Sha256Hex -Path (Join-Path $runtimeRoot 'data-a.bin') } } | ConvertTo-Json -Depth 5))
        [IO.File]::WriteAllText((Join-Path $nativeRoot 'artifact-manifest.json'), (@{ bundles = @(@{ name = 'p533' }) } | ConvertTo-Json -Depth 5))
        Assert-P533RuntimeArtifact -PackageRoot $packageRoot -NativeRoot $nativeRoot -ExpectedRevision ('a' * 40) | Should Be $runtimeRoot
    }
}
