$deploymentPath = Join-Path $PSScriptRoot '..\..\Deploy-ToughBook.ps1'

Describe 'ToughBook Dashboard runtime restoration contract' {
    BeforeAll {
        $script:deployment = Get-Content -LiteralPath $deploymentPath -Raw
    }

    It 'discovers and stops only the installed Dashboard server path' {
        $script:deployment | Should Match 'Get-FieldOpsDashboardProcessCandidates -DashboardRoot \$InstallPath'
        $script:deployment | Should Match 'Stop-Process -Id \(\[int\]\$process\.ProcessId\)'
        $script:deployment | Should Not Match 'Get-Process\s+node|Stop-Process\s+.*node\.exe'
    }

    It 'refuses to proceed while an unverified listener owns port 3000' {
        $script:deployment | Should Match 'Get-NetTCPConnection -LocalPort 3000 -State Listen'
        $script:deployment | Should Match 'Refusing to terminate an unverified process'
    }

    It 'starts the actual deployed bundle and leaves it running' {
        $script:deployment | Should Match 'Start-FieldOpsDashboardProcess -DashboardRoot \$InstallPath'
        $script:deployment | Should Match 'Test-FieldOpsDashboardReadiness -DashboardRoot \$InstallPath -ExpectedRevision \$expectedRevision -ExpectedBundleSha256 \$expectedBundleSha256'
        $script:deployment | Should Not Match 'Ready to launch:.*npm start'
    }

    It 'requires runtime bundle identity in addition to revision parity' {
        $script:deployment | Should Match 'Get-FileHash -LiteralPath \$bundlePath -Algorithm SHA256'
        $script:deployment | Should Match 'runtime identity proven'
    }
}