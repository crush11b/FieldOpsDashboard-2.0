# Native Health Gateway Installed-Service Validation

## Scope and environment

This record covers the safely available installed-service and real-identity validation for pull request 5 on DEV-01 on 2026-07-30. The branch build was installed temporarily with the repository installer as the `FieldOpsAgent` Windows service under `NT AUTHORITY\LocalService`. The fixed pipe was `FieldOps.Agent.NativeHealth.v1`, using protocol version 1.

A disposable, no-argument probe called only `NativeHealthClient.ReadAsync`. It accepted no route, URL, command, service name, file path, credential path, or other functional input. A separate disposable, no-argument abandonment harness exercised fixed failure sequences. Neither artifact was added to source control, and both were removed with their ignored staging output after validation.

Two disposable local users and one disposable local operator group were created solely for the identity matrix. Passwords were generated in memory and were not logged or retained. Evidence below intentionally omits usernames, account SIDs, profile paths, passwords, bearer tokens, and credential contents.

## Results

Allowed outcomes are `PASS`, `FAIL`, `BLOCK`, and `NOT RUN`.

| Test | Identity or condition | Expected | Sanitized observed result | Outcome |
| --- | --- | --- | --- | --- |
| NH-IS-001 | LocalService-hosted agent | Service creates and retains the fixed pipe | SCM reported the service `Running` under LocalService. An authorized client received protocol-v1 health, proving that the LocalService-owned listener was available. | PASS |
| NH-IS-002 | Elevated local Administrator | Sanitized native health is readable | The fixed probe returned exit 0 and `Result=Ok` with only status, service identity, version, start time, check time, and uptime. | PASS |
| NH-IS-003 | Filtered unelevated administrator, operator SID absent | Access is denied | The same probe returned `ACCESS_DENIED` and exit 5. The service remained `Running`. | PASS |
| NH-IS-004 | Configured operator-group member with a fresh logon token | Sanitized native health is readable | After the optional group SID was configured and the agent restarted, the newly launched operator token returned exit 0 and `Result=Ok`. | PASS |
| NH-IS-005 | Unrelated standard user | Access is denied | A freshly launched unrelated standard-user token returned `ACCESS_DENIED` and exit 5. The service remained `Running`. | PASS |
| NH-IS-006A | Anonymous identity | Explicit deny remains enforced | The DACL policy is covered by automated ACL tests, but no safe genuine anonymous local token was available for an installed-service connection. | NOT RUN |
| NH-IS-006B | Network identity | Explicit deny remains enforced | No existing second-machine fixture was available. SMB, anonymous access, firewall rules, and sharing policy were not changed to manufacture one. Automated ACL inspection remains available separately. | NOT RUN |
| NH-IS-007 | Immediate client abandonment | Listener remains available | A client connected and closed immediately; a subsequent authorized request succeeded. | PASS |
| NH-IS-008 | Truncated request followed immediately by a valid request | Cleanup is bounded and the next request succeeds within the client's five-second operation bound | After a client sent a declared 64-byte frame containing one byte and disconnected, the next authorized client timed out while connecting. The harness terminated with an unhandled `OperationCanceledException` from `NativeHealthClient.ReadAsync`. SCM still reported `Running` and one agent process remained. | FAIL |
| NH-IS-009 | Unread response, malformed request, and 30-second idle interval | Each condition is bounded and followed by a successful request | These later harness phases were not reached after NH-IS-008 failed. A proposed recovery probe was canceled at UAC and is not counted as evidence. | NOT RUN |
| NH-IS-010 | HTTP credential boundary | No bearer credential is exposed or required | Both successful identities used the native client without reading, transmitting, locating, or changing the protected HTTP health credential. The unrelated user remained denied. | PASS |
| NH-IS-011 | Pipe operation surface | No restart or control capability exists | The installed gateway accepted only the fixed read-health protocol request. The probes supplied no command or caller-selected operation; repository automated contract tests cover unsupported requests. | PASS |
| NH-IS-012 | Independent SCM observability | Service state remains observable when native health is unavailable | During filtered-token denial and the post-truncation native-health failure, SCM independently reported `FieldOpsAgent` as `Running`. | PASS |
| NH-IS-013 | Cleanup | No disposable identity, configuration, service, credential, or artifact remains installed | The optional service environment setting was removed; both users and the group were deleted; the service was restarted before uninstall; the repository uninstaller returned 0; SCM, process, installation-path, and data-path checks were all empty or false. | PASS |

## Concrete defect

NH-IS-008 is a concrete reliability defect and a pull-request merge blocker. A truncated request from an authorized client that disconnects can leave the installed gateway unable to accept the immediately following valid client within the public client's five-second operation timeout. The Windows service process remains alive, so SCM state alone does not reveal the native-health outage.

The observed failure must not be reclassified as a successful bounded cleanup merely because the service stayed `Running`. Before merge, remediation needs an installed-service regression proving that immediate close, truncated frames, unread responses, malformed requests, and acknowledgement failures are each followed by a successful request within the documented client bound, without restarting the service.

## Remediation and installed-service rerun

The defect was remediated and rerun on DEV-01 on 2026-07-30. Investigation reproduced the installed failure in the production-path automated test: Windows message-mode request reading remained pending after the one-byte message, leaving the only persistent pipe instance connected until cleanup. The server and client previously had identical five-second bounds, so listener recovery began only as the next client exhausted its own timeout.

The corrected design retains the fixed pipe and `FirstPipeInstance` fail-closed ownership check. Connected-client processing now has a one-second server bound inside the client's five-second end-to-end bound. Cancellation disposes the damaged pipe handle, interrupting pending I/O without calling synchronous `Disconnect()`. Each operation then reacquires a fresh first instance. Failure to reacquire exclusive ownership continues through the existing typed, bounded hosted-service retry path.

One elevated orchestration installed the corrected branch build, ran all phases in order, and uninstalled it in `finally`. Elevation was requested once and was not retried.

| Rerun test | Observed result | Outcome |
| --- | --- | --- |
| NH-RR-001 — Baseline | LocalService-hosted service returned sanitized native health. | PASS |
| NH-RR-002 — Original 64-byte declaration with one payload byte | The immediately following valid request succeeded within its bound. | PASS |
| NH-RR-003 — Declared frame with zero payload bytes | The immediately following valid request succeeded. | PASS |
| NH-RR-004 — Partial frame-length prefix | The immediately following valid request succeeded. | PASS |
| NH-RR-005 — Malformed payload | The immediately following valid request succeeded. | PASS |
| NH-RR-006 — Unread response | A second valid request succeeded while the first client retained an unread response. | PASS |
| NH-RR-007 — Idle listener | A valid request succeeded after a five-second connection-free idle interval. | PASS |
| NH-RR-008 — Service continuity and cleanup | The service remained `Running` after the sequence; the uninstaller completed; no service or agent process remained. | PASS |

Automated coverage additionally passes for immediate disconnect during request reading, repeated truncated clients, truncated acknowledgement, shutdown during partial input, shutdown during response writing, and shutdown during acknowledgement waiting.

## Security-boundary observations

- Elevated Administrators were distinguished from a filtered administrator token in actual Windows access checks.
- The optional operator-group SID was evaluated after an agent restart, and a newly launched group-member token succeeded.
- A separate standard-user token without operator membership was denied.
- No bearer credential or credential material crossed the pipe or appeared in evidence.
- No restart, arbitrary command, privileged HTTP control, telemetry, tray integration, installer modification, or deployment change was introduced.
- Genuine Anonymous and Network connections remain environment-dependent and were not simulated by weakening Windows policy.

## Cleanup and retention

All disposable users, group membership, the local group, service environment configuration, validation probe copies, output files, installed service files, protected validation credential, and Event Log source were removed. The ignored local build/probe staging directory was deleted after the repository verification run. Only this sanitized Markdown record is intended for source control.

## Classification

**Validation passed with environmental cases remaining.** NH-IS-008 remains above as the original historical failure. The remediation and installed-service rerun closed that concrete merge blocker, and the real-identity authorization seam behaved as designed for every safely available local identity. Genuine Anonymous and Network execution remain `NOT RUN` without suitable identities or a network fixture; automated DACL coverage remains passing. Task 2.3-03 remains incomplete regardless of this result; tray integration, production provisioning/lifecycle work, representative hardware validation, and remaining environmental cases are separate gates.
