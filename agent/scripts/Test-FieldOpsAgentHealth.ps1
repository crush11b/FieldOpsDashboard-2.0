[CmdletBinding()]
param(
    [string]$CredentialPath = (Join-Path $env:ProgramData 'FieldOpsDashboard\Agent\health-token.dat'),
    [uri]$HealthUri = 'http://127.0.0.1:43120/api/v1/health'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$protectedToken = [IO.File]::ReadAllBytes($CredentialPath)
$tokenBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $protectedToken,
    $null,
    [Security.Cryptography.DataProtectionScope]::LocalMachine)

try {
    $token = [Text.Encoding]::UTF8.GetString($tokenBytes)
    $headers = @{ Authorization = "Bearer $token" }
    Invoke-RestMethod -Method Get -Uri $HealthUri -Headers $headers -UseBasicParsing
} finally {
    [Array]::Clear($tokenBytes, 0, $tokenBytes.Length)
    $token = $null
    $headers = $null
}
