Set-StrictMode -Version Latest
$script:StartupValueName = 'FieldOpsDashboardTray'
$script:StartupSubKey = 'Software\Microsoft\Windows\CurrentVersion\Run'
$script:LegacyShortcutName = 'FieldOpsDashboard.lnk'

if ($null -eq ('FieldOpsDashboard.Deployment.UserHive' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace FieldOpsDashboard.Deployment
{
    public static class UserHive
    {
        public static void Load(string sid, string hivePath)
        {
            var result = RegLoadKey(new IntPtr(-2147483645), sid, hivePath);
            if (result != 0) throw new Win32Exception(result, "Could not load the operator registry hive.");
        }

        public static void Unload(string sid)
        {
            var result = RegUnLoadKey(new IntPtr(-2147483645), sid);
            if (result != 0) throw new Win32Exception(result, "Could not unload the operator registry hive.");
        }

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int RegLoadKey(IntPtr hKey, string subKey, string file);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int RegUnLoadKey(IntPtr hKey, string subKey);
    }
}
'@
}

function Assert-FieldOpsOperatorSid {
    param([Parameter(Mandatory = $true)][string]$OperatorSid)
    try { [void][Security.Principal.SecurityIdentifier]::new($OperatorSid) }
    catch { throw "Operator SID '$OperatorSid' is invalid." }
}

function Get-FieldOpsOperatorProfilePath {
    param([Parameter(Mandatory = $true)][string]$OperatorSid)
    Assert-FieldOpsOperatorSid -OperatorSid $OperatorSid
    $profileKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::LocalMachine,
        [Microsoft.Win32.RegistryView]::Registry64).OpenSubKey("SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$OperatorSid")
    try {
        if ($null -eq $profileKey) { throw "Profile registry state for operator SID '$OperatorSid' was not found." }
        $profilePath = [string]$profileKey.GetValue('ProfileImagePath', $null)
        if ([string]::IsNullOrWhiteSpace($profilePath)) { throw "Profile path for operator SID '$OperatorSid' was not found." }
        return [Environment]::ExpandEnvironmentVariables($profilePath)
    } finally {
        if ($null -ne $profileKey) { $profileKey.Dispose() }
    }
}

function Open-FieldOpsOperatorHive {
    param([Parameter(Mandatory = $true)][string]$OperatorSid)
    Assert-FieldOpsOperatorSid -OperatorSid $OperatorSid
    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::Users,
        [Microsoft.Win32.RegistryView]::Registry64)
    $loadedByProduct = $false
    $hiveKey = $baseKey.OpenSubKey($OperatorSid, $true)
    if ($null -eq $hiveKey) {
        $profilePath = Get-FieldOpsOperatorProfilePath -OperatorSid $OperatorSid
        $hivePath = Join-Path $profilePath 'NTUSER.DAT'
        if (-not (Test-Path -LiteralPath $hivePath -PathType Leaf)) {
            $baseKey.Dispose()
            throw "Operator registry hive '$hivePath' was not found."
        }
        [FieldOpsDashboard.Deployment.UserHive]::Load($OperatorSid, $hivePath)
        $loadedByProduct = $true
        $hiveKey = $baseKey.OpenSubKey($OperatorSid, $true)
    }
    if ($null -eq $hiveKey) {
        if ($loadedByProduct) { [FieldOpsDashboard.Deployment.UserHive]::Unload($OperatorSid) }
        $baseKey.Dispose()
        throw "Operator registry hive '$OperatorSid' could not be opened after loading."
    }
    return [pscustomobject]@{ BaseKey = $baseKey; HiveKey = $hiveKey; LoadedByProduct = $loadedByProduct; OperatorSid = $OperatorSid }
}

function Close-FieldOpsOperatorHive {
    param([Parameter(Mandatory = $true)]$Context)
    try {
        if ($null -ne $Context.HiveKey) { $Context.HiveKey.Dispose() }
    } finally {
        try {
            if ($Context.LoadedByProduct) { [FieldOpsDashboard.Deployment.UserHive]::Unload($Context.OperatorSid) }
        } finally {
            if ($null -ne $Context.BaseKey) { $Context.BaseKey.Dispose() }
        }
    }
}

function Get-FieldOpsTrayCommand {
    param([Parameter(Mandatory = $true)][string]$TrayPath)
    $resolved = (Resolve-Path -LiteralPath $TrayPath -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf) -or
        [IO.Path]::GetFileName($resolved) -ne 'FieldOps.Tray.exe') {
        throw "FieldOps tray executable was not found at '$TrayPath'."
    }
    return [pscustomobject]@{ Path = $resolved; Command = '"{0}"' -f $resolved }
}

function Register-FieldOpsTrayStartup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$TrayPath,
        [Parameter(Mandatory = $true)][string]$OperatorSid
    )
    $tray = Get-FieldOpsTrayCommand -TrayPath $TrayPath
    $context = Open-FieldOpsOperatorHive -OperatorSid $OperatorSid
    try {
        $runKey = $context.HiveKey.CreateSubKey($script:StartupSubKey)
        try { $runKey.SetValue($script:StartupValueName, $tray.Command, [Microsoft.Win32.RegistryValueKind]::String) }
        finally { $runKey.Dispose() }
        $verifyKey = $context.HiveKey.OpenSubKey($script:StartupSubKey, $false)
        try {
            $actual = if ($null -eq $verifyKey) { $null } else { [string]$verifyKey.GetValue($script:StartupValueName, $null) }
        } finally { if ($null -ne $verifyKey) { $verifyKey.Dispose() } }
        if ($actual -ne $tray.Command) { throw "Operator SID '$OperatorSid' startup registration could not be verified." }
        return [pscustomobject]@{ ValueName = $script:StartupValueName; RegistryPath = "HKU:\$OperatorSid\$script:StartupSubKey"; OperatorSid = $OperatorSid; TrayPath = $tray.Path; Command = $tray.Command }
    } finally { Close-FieldOpsOperatorHive -Context $context }
}

function Remove-FieldOpsTrayStartup {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$OperatorSid)
    $context = Open-FieldOpsOperatorHive -OperatorSid $OperatorSid
    try {
        $runKey = $context.HiveKey.OpenSubKey($script:StartupSubKey, $true)
        if ($null -ne $runKey) {
            try {
                if ($null -ne $runKey.GetValue($script:StartupValueName, $null)) { $runKey.DeleteValue($script:StartupValueName, $false) }
            } finally { $runKey.Dispose() }
        }
    } finally { Close-FieldOpsOperatorHive -Context $context }
}

function Remove-FieldOpsLegacyDashboardStartup {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$OperatorSid)
    $profilePath = Get-FieldOpsOperatorProfilePath -OperatorSid $OperatorSid
    $shortcut = Join-Path $profilePath 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\FieldOpsDashboard.lnk'
    if (Test-Path -LiteralPath $shortcut -PathType Leaf) {
        Remove-Item -LiteralPath $shortcut -Force
        return $true
    }
    return $false
}

Export-ModuleMember -Function Register-FieldOpsTrayStartup, Remove-FieldOpsTrayStartup, Remove-FieldOpsLegacyDashboardStartup
