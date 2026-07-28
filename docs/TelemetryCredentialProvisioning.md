# Telemetry Credential Provisioning

The telemetry-write credential authenticates the .NET FieldOps Agent to the Express telemetry receiver. It is a per-install, machine-generated bearer credential scoped only to `telemetry:write`. The browser never receives, stores, or submits this credential.

Provisioning credentials does not register the telemetry sender, configure a receiver URL, or transmit telemetry. Delivery remains dormant until a later explicitly approved activation task.

## Storage locations

The default Windows locations are:

- Receiver digest repository: `%ProgramData%\FieldOpsDashboard\Dashboard\telemetry-credentials.json`
- Agent protected credential: `%ProgramData%\FieldOpsDashboard\Agent\telemetry-write-token.dat`

The receiver repository contains a schema version, receiver-owned agent ID, SHA-256 token digest, scope, enabled state, and timestamps. It never contains the plaintext bearer token.

The agent file contains the plaintext token encrypted with Windows DPAPI machine scope. It is not stored in the application directory, source tree, environment configuration, command arguments, browser storage, or URLs.

The provisioning script disables inherited ACLs. SYSTEM and Administrators receive full control. The configured dashboard process identity can read the receiver repository, and `NT AUTHORITY\LocalService` can read the agent credential. If the dashboard runs under a dedicated identity, supply that account through `-DashboardIdentity`.

## First-time provisioning

Open Windows PowerShell 5.1 as Administrator from the deployed dashboard directory:

```powershell
.\agent\scripts\Provision-FieldOpsTelemetryCredential.ps1 -DashboardIdentity 'MACHINE\DashboardUser'
```

The script generates a stable agent ID when one is not supplied. To assign an approved stable ID explicitly:

```powershell
.\agent\scripts\Provision-FieldOpsTelemetryCredential.ps1 `
  -AgentId 'toughbook-primary' `
  -DashboardIdentity 'MACHINE\DashboardUser'
```

The command stages both files, verifies the receiver digest against the decrypted agent secret, applies and verifies ACLs, and then installs the pair. It prints only the agent ID, operation result, and storage locations.

Re-running the command without `-Rotate` fails rather than silently replacing an existing credential.

## Rotation

Run the same elevated command with `-Rotate`:

```powershell
.\agent\scripts\Provision-FieldOpsTelemetryCredential.ps1 `
  -Rotate `
  -DashboardIdentity 'MACHINE\DashboardUser'
```

Rotation preserves the receiver-owned agent ID, generates a replacement token, stages and verifies both sides, and replaces the files transactionally. If any stage fails, the prior valid pair is restored. The old digest is removed from the receiver repository and is therefore revoked.

The Express repository is read for every authentication attempt, so it does not require restart after rotation. The agent credential store also reads on demand; delivery is currently dormant and no agent restart is required by this slice.

## Revocation

Set the receiver record's `enabled` field to `false` through a future approved administration tool, or remove the complete credential pair while telemetry delivery is stopped. Manual edits are discouraged because malformed repository data fails closed.

There is no browser endpoint for provisioning, reading, rotating, or revoking credentials.

## Verification and recovery

Successful provisioning reports that the credential was created or rotated and identifies both paths without printing secret material. Express reports a safe startup warning when the repository is missing or invalid; the dashboard continues to run, but telemetry POST authentication rejects all credentials.

If either file is deleted or corrupt:

1. Keep telemetry delivery disabled.
2. Remove the incomplete pair if necessary.
3. Run first-time provisioning again, or restore both matching files from a protected backup.
4. Confirm the script completes its pair verification.

Never copy the agent token into React configuration, browser storage, `.env` files, source files, logs, tickets, chat messages, or command-line arguments.
