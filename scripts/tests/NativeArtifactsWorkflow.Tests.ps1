Describe 'Native artifact publication workflow' {
    BeforeAll {
        $workflow = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\.github\workflows\native-artifacts.yml') -Raw
        $publisher = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\agent\scripts\Publish-ImmutableNativeRelease.ps1') -Raw
    }

    It 'uses the race-safe immutable publisher' {
        $workflow | Should Match 'Publish-ImmutableNativeRelease\.ps1'
        $publisher | Should Match 'Assert-ExistingRelease'
        $publisher | Should Match 'different content'
        $publisher | Should Match 'git/ref/tags'
    }
}