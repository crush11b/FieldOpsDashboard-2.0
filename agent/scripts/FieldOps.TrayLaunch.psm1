Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$operatorProvisioningModule = Join-Path $PSScriptRoot 'FieldOps.OperatorProvisioning.psm1'
Import-Module $operatorProvisioningModule -Force

if ($null -eq ('FieldOpsDashboard.Deployment.InteractiveProcess' -as [type]) -or
    $null -eq ('FieldOpsDashboard.Deployment.CallerPrivileges' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace FieldOpsDashboard.Deployment
{
    public sealed class PrivilegeStatus
    {
        public string Name { get; internal set; }
        public string State { get; internal set; }
    }

    public static class CallerPrivileges
    {
        private const uint TokenQuery = 0x0008;
        private const uint TokenPrivileges = 3;
        private const uint PrivilegeEnabled = 0x00000002;
        private const int ErrorInsufficientBuffer = 122;
        private const int EntrySize = 12;
        private static readonly string[] Names = new[] { "SeAssignPrimaryTokenPrivilege", "SeIncreaseQuotaPrivilege", "SeImpersonatePrivilege" };

        public static PrivilegeStatus[] GetCurrentStates()
        {
            IntPtr token = IntPtr.Zero;
            try
            {
                token = OpenCurrentToken(TokenQuery);
                return ReadStates(token);
            }
            finally
            {
                if (token != IntPtr.Zero) NativeMethods.CloseHandle(token);
            }
        }

        private static IntPtr OpenCurrentToken(uint access)
        {
            IntPtr token;
            if (!NativeMethods.OpenProcessToken(NativeMethods.GetCurrentProcess(), access, out token))
            {
                throw LastError("OpenProcessToken(current process)");
            }
            return token;
        }

        private static PrivilegeStatus[] ReadStates(IntPtr token)
        {
            uint length = 0;
            NativeMethods.GetTokenInformation(token, TokenPrivileges, IntPtr.Zero, 0, out length);
            var error = Marshal.GetLastWin32Error();
            if (length == 0 && error != ErrorInsufficientBuffer) throw LastError("GetTokenInformation(TokenPrivileges)");
            var buffer = Marshal.AllocHGlobal((int)length);
            try
            {
                if (!NativeMethods.GetTokenInformation(token, TokenPrivileges, buffer, length, out length)) throw LastError("GetTokenInformation(TokenPrivileges)");
                var count = Marshal.ReadInt32(buffer);
                var results = new PrivilegeStatus[Names.Length];
                for (var nameIndex = 0; nameIndex < Names.Length; nameIndex++)
                {
                    results[nameIndex] = new PrivilegeStatus { Name = Names[nameIndex], State = "NotAssigned" };
                    var luid = new Luid();
                    if (!NativeMethods.LookupPrivilegeValue(null, Names[nameIndex], out luid)) throw LastError("LookupPrivilegeValue(" + Names[nameIndex] + ")");
                    for (var item = 0; item < count; item++)
                    {
                        var offset = IntPtr.Add(buffer, 4 + (item * EntrySize));
                        var current = (Luid)Marshal.PtrToStructure(offset, typeof(Luid));
                        if (current.LowPart == luid.LowPart && current.HighPart == luid.HighPart)
                        {
                            var attributes = (uint)Marshal.ReadInt32(IntPtr.Add(offset, 8));
                            results[nameIndex].State = (attributes & PrivilegeEnabled) != 0 ? "Enabled" : "Disabled";
                            break;
                        }
                    }
                }
                return results;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private static Win32Exception LastError(string operation)
        {
            var code = Marshal.GetLastWin32Error();
            return new Win32Exception(code, operation + " failed. Win32 error " + code + ": " + new Win32Exception(code).Message);
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct Luid { public uint LowPart; public int HighPart; }

        internal static class NativeMethods
        {
            [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
            [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr handle);
            [DllImport("advapi32.dll", SetLastError = true)] public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
            [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool LookupPrivilegeValue(string systemName, string name, out Luid luid);
            [DllImport("advapi32.dll", SetLastError = true)] public static extern bool GetTokenInformation(IntPtr token, uint informationClass, IntPtr information, uint length, out uint returnLength);
        }
    }

    public static class InteractiveProcess
    {
        private const uint ProcessQueryLimitedInformation = 0x1000;
        private const uint TokenAssignPrimary = 0x0001;
        private const uint TokenDuplicate = 0x0002;
        private const uint TokenQuery = 0x0008;
        private const uint SecurityImpersonation = 2;
        private const uint TokenPrimary = 1;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct StartupInfo
        {
            public uint cb;
            public string reserved;
            public string desktop;
            public string title;
            public uint x;
            public uint y;
            public uint xSize;
            public uint ySize;
            public uint xCountChars;
            public uint yCountChars;
            public uint fillAttribute;
            public uint flags;
            public ushort showWindow;
            public ushort reserved2;
            public IntPtr reserved3;
            public IntPtr standardInput;
            public IntPtr standardOutput;
            public IntPtr standardError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessInformation
        {
            public IntPtr process;
            public IntPtr thread;
            public uint processId;
            public uint threadId;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool DuplicateTokenEx(
            IntPtr existingToken,
            uint desiredAccess,
            IntPtr tokenAttributes,
            uint impersonationLevel,
            uint tokenType,
            out IntPtr duplicateToken);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateProcessWithTokenW(
            IntPtr token,
            uint logonFlags,
            string applicationName,
            StringBuilder commandLine,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref StartupInfo startupInfo,
            out ProcessInformation processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        public static int Launch(string executablePath, string workingDirectory, uint sourceProcessId)
        {
            var process = OpenProcess(ProcessQueryLimitedInformation, false, sourceProcessId);
            if (process == IntPtr.Zero) ThrowLastError("OpenProcess");
            var sourceToken = IntPtr.Zero;
            var primaryToken = IntPtr.Zero;
            var processInformation = new ProcessInformation();
            try
            {
                var tokenAccess = TokenAssignPrimary | TokenDuplicate | TokenQuery;
                if (!OpenProcessToken(process, tokenAccess, out sourceToken)) ThrowLastError("OpenProcessToken");
                if (!DuplicateTokenEx(sourceToken, tokenAccess, IntPtr.Zero, SecurityImpersonation, TokenPrimary, out primaryToken)) ThrowLastError("DuplicateTokenEx");
                var startup = new StartupInfo { cb = (uint)Marshal.SizeOf<StartupInfo>(), desktop = null };
                var commandLine = new StringBuilder("\"" + executablePath + "\"");
                if (!CreateProcessWithTokenW(primaryToken, 0, executablePath, commandLine, 0, IntPtr.Zero, workingDirectory, ref startup, out processInformation)) ThrowLastError("CreateProcessWithTokenW");
                return checked((int)processInformation.processId);
            }
            finally
            {
                if (processInformation.thread != IntPtr.Zero) CloseHandle(processInformation.thread);
                if (processInformation.process != IntPtr.Zero) CloseHandle(processInformation.process);
                if (primaryToken != IntPtr.Zero) CloseHandle(primaryToken);
                if (sourceToken != IntPtr.Zero) CloseHandle(sourceToken);
                CloseHandle(process);
            }
        }

        private static void ThrowLastError(string operation)
        {
            var errorCode = Marshal.GetLastWin32Error();
            throw new Win32Exception(errorCode, FormatWin32Error(errorCode, operation));
        }

        public static string FormatWin32Error(int errorCode, string operation)
        {
            var nativeMessage = new Win32Exception(errorCode).Message;
            return operation + " failed. Win32 error " + errorCode + ": " + nativeMessage;
        }
    }
}
'@
}

function Get-FieldOpsInteractiveSessionCandidates {
    [CmdletBinding()]
    param(
        [scriptblock]$ExplorerProvider = { Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" -ErrorAction Stop },
        [scriptblock]$OwnerResolver = { param($Process) Invoke-CimMethod -InputObject $Process -MethodName GetOwner -ErrorAction Stop },
        [scriptblock]$AccountResolver = { param($Account) Resolve-FieldOpsLocalOperatorAccount -Account $Account }
    )

    foreach ($process in @(& $ExplorerProvider)) {
        $owner = & $OwnerResolver $process
        if ($null -eq $owner -or [int]$owner.ReturnValue -ne 0) { continue }
        $user = [string]$owner.User
        $domain = [string]$owner.Domain
        if ([string]::IsNullOrWhiteSpace($user)) { continue }
        $candidate = if ([string]::IsNullOrWhiteSpace($domain)) { $user } else { '{0}\{1}' -f $domain, $user }
        $resolved = & $AccountResolver $candidate
        [pscustomobject]@{
            Account = [string]$resolved.Name
            Sid = [string]$resolved.Sid
            SessionId = [int]$process.SessionId
            ProcessId = [int]$process.ProcessId
        }
    }
}

function Get-FieldOpsCallerPrivilegeState {
    return [FieldOpsDashboard.Deployment.CallerPrivileges]::GetCurrentStates()
}

function Get-FieldOpsTrayProcessCandidates {
    [CmdletBinding()]
    param(
        [scriptblock]$ProcessProvider = { Get-CimInstance Win32_Process -Filter "Name = 'FieldOps.Tray.exe'" -ErrorAction SilentlyContinue },
        [scriptblock]$OwnerResolver = { param($Process) Invoke-CimMethod -InputObject $Process -MethodName GetOwner -ErrorAction Stop },
        [scriptblock]$AccountResolver = { param($Account) Resolve-FieldOpsLocalOperatorAccount -Account $Account }
    )

    foreach ($process in @(& $ProcessProvider)) {
        if ([string]::IsNullOrWhiteSpace([string]$process.ExecutablePath)) { continue }
        try {
            $owner = & $OwnerResolver $process
            if ($null -eq $owner -or [int]$owner.ReturnValue -ne 0) { continue }
            $user = [string]$owner.User
            $domain = [string]$owner.Domain
            if ([string]::IsNullOrWhiteSpace($user)) { continue }
            $candidate = if ([string]::IsNullOrWhiteSpace($domain)) { $user } else { '{0}\{1}' -f $domain, $user }
            $resolved = & $AccountResolver $candidate
            [pscustomobject]@{
                Account = [string]$resolved.Name
                Sid = [string]$resolved.Sid
                SessionId = [int]$process.SessionId
                ProcessId = [int]$process.ProcessId
                ExecutablePath = [string]$process.ExecutablePath
            }
        } catch {
        }
    }
}

function Start-FieldOpsTray {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$TrayPath,
        [Parameter(Mandatory = $true)][string]$OperatorAccount,
        [Parameter(Mandatory = $true)][string]$OperatorSid,
        [scriptblock]$SessionProvider = { Get-FieldOpsInteractiveSessionCandidates },
        [scriptblock]$TrayProcessProvider = { Get-FieldOpsTrayProcessCandidates },
        [scriptblock]$ProcessLauncher = { param($Session, $Path) [FieldOpsDashboard.Deployment.InteractiveProcess]::Launch($Path, (Split-Path -Parent $Path), [uint32]$Session.ProcessId) },
        [int]$TimeoutSeconds = 15,
        [int]$PollMilliseconds = 100
    )

    $resolvedTrayPath = (Resolve-Path -LiteralPath $TrayPath -ErrorAction Stop).Path
    if ([IO.Path]::GetFileName($resolvedTrayPath) -ne 'FieldOps.Tray.exe' -or
        -not (Test-Path -LiteralPath $resolvedTrayPath -PathType Leaf)) {
        throw "FieldOps tray executable was not found at '$TrayPath'."
    }

    $sessions = @(& $SessionProvider | Where-Object {
        [string]::Equals([string]$_.Sid, $OperatorSid, [StringComparison]::OrdinalIgnoreCase) -and
        [string]::Equals([string]$_.Account, $OperatorAccount, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($sessions.Count -eq 0) {
        throw "No active interactive session was found for operator '$OperatorAccount' (SID $OperatorSid)."
    }
    $sessionIds = @($sessions | Select-Object -ExpandProperty SessionId -Unique)
    if ($sessionIds.Count -ne 1) {
        throw "Operator '$OperatorAccount' (SID $OperatorSid) has multiple active interactive sessions."
    }
    $session = $sessions[0]
    $callerSessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
    if ($callerSessionId -ne [int]$session.SessionId) {
        throw "Resolved operator '$OperatorAccount' is in interactive session $($session.SessionId), but the caller is in session $callerSessionId. This single-operator deployment path does not support cross-session Tray launch."
    }

    $existing = @(& $TrayProcessProvider | Where-Object {
        [string]::Equals([string]$_.ExecutablePath, $resolvedTrayPath, [StringComparison]::OrdinalIgnoreCase) -and
        [string]::Equals([string]$_.Sid, $OperatorSid, [StringComparison]::OrdinalIgnoreCase) -and
        [int]$_.SessionId -eq [int]$session.SessionId
    })
    if ($existing.Count -gt 1) {
        throw "Multiple FieldOps Tray instances already run for '$OperatorAccount' in session $($session.SessionId)."
    }
    if ($existing.Count -eq 1) {
        return [pscustomobject]@{ Status = 'AlreadyRunning'; Account = $OperatorAccount; Sid = $OperatorSid; SessionId = [int]$session.SessionId; ProcessId = [int]$existing[0].ProcessId; TrayPath = $resolvedTrayPath }
    }

    $launchedProcessId = [int](& $ProcessLauncher $session $resolvedTrayPath)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $running = @(& $TrayProcessProvider | Where-Object {
            [string]::Equals([string]$_.ExecutablePath, $resolvedTrayPath, [StringComparison]::OrdinalIgnoreCase) -and
            [string]::Equals([string]$_.Sid, $OperatorSid, [StringComparison]::OrdinalIgnoreCase) -and
            [int]$_.SessionId -eq [int]$session.SessionId
        })
        if ($running.Count -eq 1) {
            return [pscustomobject]@{ Status = 'Running'; Account = $OperatorAccount; Sid = $OperatorSid; SessionId = [int]$session.SessionId; ProcessId = [int]$running[0].ProcessId; TrayPath = $resolvedTrayPath }
        }
        if ($running.Count -gt 1) {
            throw "Multiple FieldOps Tray instances appeared for '$OperatorAccount' in session $($session.SessionId)."
        }
        Start-Sleep -Milliseconds $PollMilliseconds
    }

    throw "FieldOps Tray launch was accepted as PID $launchedProcessId, but it did not appear for '$OperatorAccount' in interactive session $($session.SessionId) within $TimeoutSeconds seconds."
}

Export-ModuleMember -Function Get-FieldOpsCallerPrivilegeState, Get-FieldOpsInteractiveSessionCandidates, Get-FieldOpsTrayProcessCandidates, Start-FieldOpsTray
