$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$launcher = Get-Content (Join-Path $repositoryRoot 'start.bat') -Raw

if ($launcher -match '(?im)^\s*(call\s+)?npm\s+install\b') {
    throw 'start.bat must not install packages during offline startup.'
}
if ($launcher -notmatch '(?im)node_modules\\tsx\\package\.json' -or $launcher -notmatch '(?im)node_modules\\express\\package\.json' -or $launcher -notmatch '(?im)node_modules\\vite\\package\.json') {
    throw 'start.bat must check for required dependencies.'
}
if ($launcher -notmatch '(?im)installation is incomplete') {
    throw 'start.bat must report an incomplete installation.'
}
if ($launcher -notmatch '(?im)exit\s+/b\s+1') {
    throw 'start.bat must exit nonzero when dependencies are missing.'
}
if ($launcher -notmatch '(?im)set\s+"NODE_ENV=production"') {
    throw 'start.bat must preserve production startup mode.'
}

Write-Output 'start.bat dependency and production-mode checks passed.'
