Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$operatorProvisioningModule = Join-Path $PSScriptRoot 'FieldOps.OperatorProvisioning.psm1'
Import-Module $operatorProvisioningModule -Force

if ($null -eq ('FieldOpsDashboard.Deployment.InteractiveProcess' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace FieldOpsDashboard.Deployment
{
    public static class InteractiveProcess
    {
        private const uint ProcessQueryLimitedInformation = 0x1000;
        private const uint TokenAssignPrimary = 0x0001;
        private const uint TokenDuplicate = 0x0002;
        private const uint TokenQuery = 0x0008;
        private const uint SecurityImpersonation = 2;
        private const uint TokenPrimary = 1;
        private const uint CreateUnicodeEnvironment = 0x00000400;

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
        private static extern bool CreateProcessAsUser(
            IntPtr token,
            string applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            bool inheritHandles,
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
                var startup = new StartupInfo { cb = (uint)Marshal.SizeOf<StartupInfo>(), desktop = "winsta0\\default" };
                var commandLine = new StringBuilder("\"" + executablePath + "\"");
                if (!CreateProcessAsUser(primaryToken, executablePath, commandLine, IntPtr.Zero, IntPtr.Zero, false, CreateUnicodeEnvironment, IntPtr.Zero, workingDirectory, ref startup, out processInformation)) ThrowLastError("CreateProcessAsUser");
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

Export-ModuleMember -Function Get-FieldOpsInteractiveSessionCandidates, Get-FieldOpsTrayProcessCandidates, Start-FieldOpsTray
