# Tray Native-Health Client Installed-Service Validation

## Scope and environment

This record covers the safely available installed-service validation of the Task 2.3-03 tray native-health client slice on DEV-01 on 2026-07-30. The branch agent ran temporarily as the `FieldOpsAgent` Windows service under LocalService. The branch tray ran interactively under an authorized elevated-administrator token and a filtered unelevated-administrator token.

The validation covered only shared `NativeHealthClient` integration, independent SCM observation, presentation mapping, refresh coordination, and shutdown behavior. It did not provision production identities, change pipe or credential ACLs, add startup or packaging behavior, or exercise restart through the tray. Elevation was accepted once for the temporary installed-service controller and was not requested again.

Evidence intentionally omits account names, SIDs, credentials, bearer tokens, user-profile paths, and staging paths.

## Results

Allowed outcomes are `PASS`, `FAIL`, `BLOCK`, and `NOT RUN`.

| Test | Identity and setup | SCM observation | Native-health observation | Observed behavior | Outcome |
| --- | --- | --- | --- | --- | --- |
| TNH-001 - Healthy baseline | Authorized elevated administrator; LocalService agent running | `Running` | `Healthy` | Tray displayed **Service: Running** and **Health: Healthy**. No UAC prompt appeared during refresh. | PASS |
| TNH-002 - Agent stopped and recovered | Service stopped and restarted externally through the one-time elevated controller | `Stopped`, then `Running` | `Service stopped`, then `Healthy` | The stopped observation replaced the prior successful result. After external restart and tray relaunch, the display recovered to **Service: Running** and **Health: Healthy**. The tray remained responsive. | PASS |
| TNH-003 - Genuine transition | External stop/start completed too quickly to retain a start-pending or stop-pending state | No stable transitional state captured | Not evaluated | No service delay was manufactured. | NOT RUN |
| TNH-004 - Native unavailable while SCM running | No supported listener-disable configuration was available | `Running` | Fixture unavailable | The native listener could not be disabled safely without a production change or pipe substitution. | NOT RUN |
| TNH-005 - Access denied | Filtered unelevated administrator, not enrolled in the native-health ACL | `Running` | `Access denied` | Tray displayed **Service: Running** and **Health: Access Denied**. Refresh produced no UAC prompt, elevation retry, helper process, or service transition. | PASS |
| TNH-006 - Protocol mismatch or rejected response | Validation-only pipe substitution considered | Independently observable | Automated mappings only | Exclusive pipe ownership prevented safe installed substitution. Automated coverage verifies distinct **Protocol mismatch** and **Response rejected** presentation. | NOT RUN |
| TNH-007 - Refresh overlap and stale suppression | Rapid manual refreshes during an external stop/start | Repeated `Running`, one completed `Stopped`, then repeated `Running` | Health text was not observed during the single stopped display | A completed stopped observation occurred between running observations, and later running results remained current after restart. No later stopped result overwrote the final running observations. Field coverage of the SCM stale-result path passed; native-health supersession remains covered deterministically by automated tests. | PASS |
| TNH-008 - Timeout behavior | Validation-only nonresponding pipe fixture considered | Independently observable | Automated timeout mapping only | Exclusive ownership prevented safe installed substitution. Automated coverage verifies bounded timeout and **Timed out** presentation. | NOT RUN |
| TNH-009 - Shutdown during active refresh | Refresh initiated while the stopped service made native connection work pending; Exit selected immediately | Service was externally stopped | Request pending at shutdown | The notification icon disappeared promptly with no crash, popup, or delayed UI update. No tray or helper process remained. | PASS |
| TNH-010 - Five-minute idle stability | Filtered unelevated administrator; one sampled tray PID; LocalService agent running | `Running` throughout | Final sampled tray displayed `Access denied` | Over 300 seconds, the tray remained responsive, CPU time stayed at 0.140625 seconds, working set changed from 42.46 MB to 42.25 MB, private memory changed from 9.59 MB to 9.22 MB, and no helper ran. Final Refresh remained honest. | PASS |

## Repeated-launch observation

At the end of TNH-010, two notification icons were visible. One tray displayed **Service: Running** and **Health: Access Denied**; the other displayed **Service: Running** and **Health: Healthy**. Both exited through their menus without an error or popup.

This is additional evidence for the existing TRAY-003 failure: the disposable prototype allows concurrent tray instances. The distinct health results are consistent with the two Windows authorization contexts exercised during validation and demonstrate that SCM state remained independent of native-health authorization. This slice does not change the already documented production requirement to define and enforce a single-instance boundary. ADR-003 defers production process lifecycle and single-instance behavior, so no architecture or planning change is required here.

## Coverage notes

- The service-transition test remains `NOT RUN`; one stopped state was observed during rapid refresh, but no start-pending or stop-pending state was held long enough to validate presentation.
- Protocol mismatch, rejected response, timeout, refresh cancellation, and stale-result suppression retain deterministic automated coverage where an installed fixture could not safely own the fixed pipe.
- The tray menu closing after selecting Refresh is normal notification-menu behavior; the icon remained available and the tray remained responsive.
- No HTTP bearer credential was opened, read, transmitted, copied, or required by the tray.
- No restart or other control operation was added to or exercised through native health.
- No concrete production correctness defect was found in the bounded native-health client integration.

## Cleanup status

Both tray instances exited cleanly, no service-control helper remained, and the repository-local validation staging directory was removed. No validation probe, generated project, script, credential, binary, or staging output remains beneath `agent/obj` or appears in Git status.

The one-time elevated validation controller expired before processing its final cleanup request. The temporary `FieldOpsAgent` installation therefore initially remained running under LocalService. The filtered unelevated-administrator token was correctly denied permission to stop or delete it, and validation did not generate a second UAC request. The operator subsequently used an already elevated PowerShell session to run the repository uninstaller. Final verification returned SCM error 1060 (service not installed), found no agent process, and confirmed that the program and data installation directories were absent. The controller expiry was a validation-orchestration cleanup issue, not a tray native-health production defect.

## Classification

**Safely available installed-service slice passed with environmental cases remaining.** Six installed cases passed and four were not run because they required a genuine transition or a fixture incompatible with safe exclusive pipe ownership. Final service cleanup passed. The existing disposable-prototype repeated-launch limitation was reconfirmed and remains a production single-instance requirement.

Task 2.3-03 remains incomplete. Production tray lifecycle, single-instance behavior, provisioning, packaging, startup, signing, representative hardware validation, and remaining environment-dependent validation are separate gates.
