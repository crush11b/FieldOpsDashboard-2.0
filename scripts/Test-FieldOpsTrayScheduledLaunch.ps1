[CmdletBinding()]
param(
    [string]$InstallPath = 'C:\FieldOpsDashboard',
    [string]$OperatorAccount,
    [int]$TimeoutSeconds = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$operatorResolutionModule = Join-Path $scriptDirectory '..\agent\scripts\FieldOps.OperatorResolution.psm1'
$scheduledLaunchModule = Join-Path $scriptDirectory '..\agent\scripts\FieldOps.TrayScheduledLaunch.psm1'
Import-Module $operatorResolutionModule -Force
Import-Module $scheduledLaunchModule -Force

$operator = Resolve-FieldOpsInteractiveOperator -OperatorAccount $OperatorAccount
$trayPath = Join-Path $env:ProgramFiles 'FieldOpsDashboard\Tray\FieldOps.Tray.exe'
Write-Output ('Dashboard install path: {0}' -f ([IO.Path]::GetFullPath($InstallPath)))
Write-Output ('Tray path: {0}' -f $trayPath)
Write-Output ('FieldOps operator: {0}' -f $operator.Account)
Write-Output ('SID: {0}' -f $operator.Sid)
Write-Output 'Logon type: InteractiveToken'
Write-Output 'Password supplied/stored: False'
$result = Start-FieldOpsTrayScheduledLaunch -TrayPath $trayPath -OperatorAccount $operator.Account -OperatorSid $operator.Sid -TimeoutSeconds $TimeoutSeconds
Write-Output ('Tray status: {0}' -f $result.Status)
Write-Output ('Observed Tray PID/session/SID: {0}/{1}/{2}' -f $result.ProcessId, $result.SessionId, $result.Sid)
Write-Output 'Temporary task cleanup: success'
