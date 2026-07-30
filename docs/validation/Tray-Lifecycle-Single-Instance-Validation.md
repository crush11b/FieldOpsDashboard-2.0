# Tray Lifecycle and Single-Instance Validation

## Scope

This record covers the bounded Task 2.3-03 production lifecycle and per-Windows-session single-instance slice on DEV-01. It does not install or register the tray, create users or groups, change native-health or restart authorization, modify telemetry, or change packaging and startup behavior.

The production lock is the protected Windows mutex `Local\FieldOps.Tray.Instance.v1`. It provides one primary tray per Windows session, with access restricted to the creating user and LocalSystem. The same identity in the same session can access the existing mutex and receives duplicate exit code 10. The same identity in a different session uses a separate `Local\` object and can run an independent primary. A different identity in the same session normally cannot access the protected mutex and receives acquisition failure 20 rather than duplicate status or an independent primary. A different identity in another session can run an independent primary. LocalSystem in the same session/object namespace is authorized and contends for the same mutex. Fast User Switching and RDP normally use distinct session-local namespaces, allowing one primary per session. These are documented Windows semantics, not additional DEV-01 observations. No account SID, user name, machine path, credential, or token is retained in this evidence.

## Exit-code contract

| Code | Meaning |
| ---: | --- |
| 0 | Primary instance completed normal lifecycle shutdown. |
| 10 | Duplicate instance exited before tray-host construction. |
| 20 | Instance acquisition, startup, or lifecycle failed with sanitized diagnostics. |

## Automated results

| Test area | Observed result | Outcome |
| --- | --- | --- |
| First acquisition and release/reacquisition | First owner acquired; disposal allowed a later owner. | PASS |
| Same-session duplicate | A second thread using the production primitive received `Duplicate`. | PASS |
| Concurrent first launch | Two synchronized acquisition attempts produced exactly one owner and one duplicate. | PASS |
| Abandoned ownership | A later acquisition recovered ownership after the owner thread exited. | PASS |
| Duplicate lifecycle path | Exit code 10 occurred before host construction; no refresh infrastructure was constructed. | PASS |
| Primary lifecycle | Host was created, started, run, and disposed once; instance ownership was released. | PASS |
| Partial startup and message-loop failure | Host resources and instance ownership were disposed; sanitized exit code 20 was returned. | PASS |
| Refresh during shutdown | Existing generation/cancellation tests suppressed pending and superseded results. | PASS |

## DEV-01 executable validation

| Case | Observed result | Outcome |
| --- | --- | --- |
| Primary process launch | Release tray PID 33804 remained live and responding; one live tray process existed. No visual icon claim was made. | PASS |
| Duplicate process launch | One duplicate exited promptly with code 10; the primary process remained responding; no helper started. | PASS |
| Four simultaneous duplicates with active primary | All four exited with code 10; exactly one primary process remained; helper count remained zero. | PASS |
| Visible icon and menu usability | The operator was not at a validation device and did not directly observe the notification area or menu. | NOT RUN |
| Graceful Exit and icon cleanup | Exit was not selected interactively; clean icon disappearance, popup absence, and user-visible error behavior were not observed. | NOT RUN |
| Non-visual forced cleanup | The verified disposable primary PID was terminated; final checks found zero tray and helper processes. This does not count as graceful Exit coverage. | PASS |
| Relaunch after process termination | A new primary PID 48116 acquired successfully and remained responding; a duplicate exited 10; final forced cleanup left zero tray/helper processes. | PASS |
| Separate session, same user | No approved second interactive session was used. | NOT RUN |
| Different interactive user | No disposable or existing alternate-user session was used. | NOT RUN |
| ToughBook/ToughPad behavior | No representative field device was available for direct observation. | NOT RUN |

## Classification and remaining gates

Task 2.3-03 remains incomplete. This slice does not install or register the tray for startup, rename/package/sign it, provision the operator group, alter authorization, or complete ToughBook/ToughPad and environmental validation. Update the pending DEV-01 rows after operator observation without rewriting earlier evidence.
