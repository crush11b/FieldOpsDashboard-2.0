$updaterPath = Join-Path $PSScriptRoot '..\..\UpdateDashboard.ps1'

Describe 'UpdateDashboard SHA-256 verification' {
    BeforeAll {
        $source = Get-Content -LiteralPath $updaterPath -Raw
        $helperMatch = [regex]::Match($source, '(?s)function Get-Sha256Hex\s*\{.*?\n\}')
        $artifactMatch = [regex]::Match($source, '(?s)function Assert-P533RuntimeArtifact\s*\{.*?\n\}')
        $manifestMatch = [regex]::Match($source, '(?s)function Assert-DeploymentManifest\s*\{.*?\n\}')
        if (-not $helperMatch.Success -or -not $artifactMatch.Success -or -not $manifestMatch.Success) { throw 'Updater verification functions could not be loaded.' }
        . ([scriptblock]::Create($helperMatch.Value))
        . ([scriptblock]::Create($artifactMatch.Value))
        . ([scriptblock]::Create($manifestMatch.Value))
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

Describe 'UpdateDashboard deployment manifest validation' {
    BeforeAll {
        $script:manifestTestRoot = Join-Path ([IO.Path]::GetTempPath()) ('fieldops-updater-manifest-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:manifestTestRoot -Force | Out-Null
    }

    AfterAll {
        if (Test-Path -LiteralPath $script:manifestTestRoot) { Remove-Item -LiteralPath $script:manifestTestRoot -Recurse -Force }
    }

    It 'accepts complete identity and matching runtime bundle hash' {
        $manifestPath = Join-Path $script:manifestTestRoot 'deployment-manifest.json'
        $bundlePath = Join-Path $script:manifestTestRoot 'server.cjs'
        [IO.File]::WriteAllText($bundlePath, 'runtime bundle', [Text.UTF8Encoding]::new($false))
        (@{
            sourceRevision = 'a' * 40
            nativeRevision = 'a' * 40
            informationalVersion = '2.9.0+' + ('a' * 40)
            runtimeBundleSha256 = Get-Sha256Hex -Path $bundlePath
        } | ConvertTo-Json) | Set-Content -LiteralPath $manifestPath

        (Assert-DeploymentManifest -ManifestPath $manifestPath -ExpectedRevision ('a' * 40) -RuntimeBundlePath $bundlePath).sourceRevision | Should Be ('a' * 40)
    }

    It 'rejects missing, malformed, incomplete, mismatched, and hashed bundles' {
        $bundlePath = Join-Path $script:manifestTestRoot 'validation-server.cjs'
        [IO.File]::WriteAllText($bundlePath, 'runtime bundle', [Text.UTF8Encoding]::new($false))
        $manifestPath = Join-Path $script:manifestTestRoot 'validation-manifest.json'
        { Assert-DeploymentManifest -ManifestPath (Join-Path $script:manifestTestRoot 'missing-manifest.json') -ExpectedRevision ('a' * 40) -RuntimeBundlePath $bundlePath } | Should Throw 'is missing'
        [IO.File]::WriteAllText($manifestPath, '{not-json', [Text.UTF8Encoding]::new($false))
        { Assert-DeploymentManifest -ManifestPath $manifestPath -ExpectedRevision ('a' * 40) -RuntimeBundlePath $bundlePath } | Should Throw 'malformed'
        (@{ sourceRevision = 'a' * 40; nativeRevision = 'a' * 40 } | ConvertTo-Json) | Set-Content -LiteralPath $manifestPath
        { Assert-DeploymentManifest -ManifestPath $manifestPath -ExpectedRevision ('a' * 40) -RuntimeBundlePath $bundlePath } | Should Throw "missing 'informationalVersion'"
        (@{ sourceRevision = 'b' * 40; nativeRevision = 'a' * 40; informationalVersion = '2.9.0' } | ConvertTo-Json) | Set-Content -LiteralPath $manifestPath
        { Assert-DeploymentManifest -ManifestPath $manifestPath -ExpectedRevision ('a' * 40) -RuntimeBundlePath $bundlePath } | Should Throw 'sourceRevision'
        (@{ sourceRevision = 'a' * 40; nativeRevision = 'a' * 40; informationalVersion = '2.9.0'; runtimeBundleSha256 = '0' * 64 } | ConvertTo-Json) | Set-Content -LiteralPath $manifestPath
        { Assert-DeploymentManifest -ManifestPath $manifestPath -ExpectedRevision ('a' * 40) -RuntimeBundlePath $bundlePath } | Should Throw 'runtimeBundleSha256'
    }
}

Describe 'UpdateDashboard runtime shutdown ordering' {
    It 'discovers and stops the Dashboard child before cleaning up launcher wrappers' {
        $source = Get-Content -LiteralPath $updaterPath -Raw
        $shutdownStage = $source.IndexOf("Write-Host '[3/8] Stopping FieldOps and dashboard processes...'")
        $runtimeShutdown = $source.IndexOf('Invoke-FieldOpsRuntimeShutdown', $shutdownStage)
        $wrapperCleanup = $source.IndexOf('Stop-FieldOpsLauncherWrappers -InstallRoot $resolvedInstallPath', $shutdownStage)

        $shutdownStage | Should BeGreaterThan -1
        $runtimeShutdown | Should BeGreaterThan $shutdownStage
        $wrapperCleanup | Should BeGreaterThan $runtimeShutdown
    }
}

Describe 'UpdateDashboard desktop rollback-validation entry point' {
    It 'refreshes the supported Desktop tools only after runtime readiness succeeds' {
        $source = Get-Content -LiteralPath $updaterPath -Raw
        $readinessPassed = $source.IndexOf("if (`$readiness.Status -eq 'Passed')")
        $shortcutSetup = $source.IndexOf("Install-FieldOpsDevelopmentUpdater.ps1') -RepositoryRoot `$resolvedInstallPath")
        $deploymentComplete = $source.IndexOf("Write-Host '[OK] FieldOps Dashboard update complete.'")
        $readinessPassed | Should BeGreaterThan -1
        $shortcutSetup | Should BeGreaterThan $readinessPassed
        $deploymentComplete | Should BeGreaterThan $shortcutSetup
    }

    It 'retains the deliberate pre-copy failure seam used by rollback validation' {
        $source = Get-Content -LiteralPath $updaterPath -Raw
        $source | Should Match '\[switch\]\$SimulateCopyFailure'
        $source | Should Match 'if \(\$SimulateCopyFailure\)[\s\S]*Simulated deployment failure'
    }
}
