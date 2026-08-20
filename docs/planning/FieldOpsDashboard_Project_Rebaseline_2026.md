# FieldOps Dashboard Project Rebaseline 2026

- Status: Approved direction
- Date: 2026-07-31
- Applies to: roadmap, engineering backlog, architecture interpretation, release planning, and implementation sequencing

## Purpose

FieldOps Dashboard exists to improve field operations. Engineering, security, and infrastructure serve that purpose; they are not the product by themselves.

The project has established a strong reliability and local-agent foundation. The next priority is to convert that foundation into a usable single-operator product on the primary Windows ToughBook/ToughPad deployment, then expand operator-facing Field Tools.

This rebaseline does not abandon the existing architecture or long-term framework. It changes sequencing so that time and budget are spent first on operational value, with broader hardening and enterprise capabilities deferred until they are justified by actual deployment needs.

## Primary supported deployment

The immediate supported deployment is:

- one primary operator;
- one locally operated Windows field computer;
- local dashboard, backend, tray, and Windows service;
- loopback-only agent communication;
- unreliable or unavailable internet connectivity;
- amateur-radio, SOTA/POTA, camping, travel, and related field operations.

Multi-user, fleet, enterprise, remote-administration, and managed-environment support remain valid future directions, but they are not current release gates.

## Product mission

Build a trustworthy, locally operated, offline-capable field operations dashboard that gives the operator useful information and practical tools during real field activity.

## Governing priorities

Work is prioritized in this order:

1. Operator value
2. Trustworthy information and honest failure states
3. Reliable local operation
4. Offline usefulness
5. Maintainability
6. Security proportionate to the current deployment
7. Future scalability and enterprise capability

## Active-release admission rule

A task belongs in the active release only when at least one of the following is true:

- it provides a capability the operator will use;
- it prevents misleading or fabricated status;
- it is required for dependable startup, recovery, update, or offline operation;
- it directly enables a high-priority field feature in the current or next release;
- it mitigates a realistic threat for the current local deployment.

A hypothetical future enterprise need is not sufficient by itself.

## Architecture disposition

### Keep

- React dashboard and local Express backend
- .NET Windows Local Agent
- trustworthy telemetry envelope, source, freshness, and provenance semantics
- localhost-only transport
- LocalService service identity
- automatic service startup and recovery
- authenticated local health
- separation between read-only telemetry and privileged operations
- no wildcard CORS at the agent boundary
- no reusable agent credential in browser storage

### Simplify now

- tray lifecycle and startup
- installer/deployment workflow
- operator provisioning
- diagnostic export
- local integration contracts
- service-control behavior

### Freeze or defer

- separate-session and alternate-user validation
- Fast User Switching and RDP behavior
- multi-role and multi-group provisioning
- generalized credential rotation and revocation UX
- broad privileged API design
- enterprise installer hardening
- code-signing infrastructure
- fleet management and centralized policy
- remote administration
- advanced support-bundle and audit frameworks

Deferred work is preserved in the backlog under a future hardening or enterprise category. It is not deleted.

## Version 2.3 redefinition

# Version 2.3 - Single-Operator Field MVP

### Release goal

Deliver a dependable ToughBook/ToughPad installation that starts reliably, reports real local location and system data, preserves trustworthy status semantics, and is usable in active field evaluation.

### Required outcomes

- dashboard and backend start reliably after reboot/login;
- Windows service starts automatically and recovers from ordinary failure;
- tray starts for the normal operator account;
- tray shows real service and native-health state;
- tray provides Open Dashboard and clean visual Exit;
- tray Exit does not stop the service;
- real serial-port enumeration is available for GNSS configuration;
- real NMEA GNSS data reaches the trusted telemetry path;
- real Windows battery, power-source, CPU, memory, storage, and network information reaches the dashboard;
- unsupported values remain nullable rather than fabricated;
- deployment/update/uninstall is documented and practical;
- the release is validated on the primary field computer;
- no temporary enterprise-style account matrix is required for normal operation.

### Not release blockers

- multi-session coexistence;
- alternate-user lifecycle validation;
- RDP and Fast User Switching;
- fleet deployment;
- polished MSI packaging;
- code signing;
- generalized credential lifecycle tooling;
- enterprise user onboarding;
- remote administration.

## Version 2.3 task sequence

1. Freeze and document this rebaseline.
2. Finish only the tray behavior required for normal single-operator use.
3. Confirm the minimal loopback integration path from dashboard/backend to agent.
4. Implement serial-port enumeration.
5. Implement the NMEA GNSS adapter.
6. Implement Windows system telemetry.
7. Consolidate startup, deployment, update, and uninstall.
8. Perform operational ToughBook/ToughPad validation.
9. Release Version 2.3.

## Current Local Agent task disposition

| Existing task | Rebaseline disposition |
| --- | --- |
| 2.3-01 Technology Spike | Complete |
| 2.3-02 Windows Service Skeleton | Operationally complete; remaining exotic validation deferred |
| 2.3-03 Tray Companion | Reduce scope; finish normal startup, status, Exit, and field validation |
| 2.3-04 Secure Local API | Narrow to minimum loopback contracts required by current clients |
| 2.3-05 SQLite Foundation | Defer until a user-facing feature requires persistence |
| 2.3-06 Agent Capability Registry | Defer until multiple real adapters justify generalization |
| 2.3-07 Serial-port Enumeration | Keep and prioritize |
| 2.3-08 NMEA GNSS Adapter | Highest-priority operator-value work |
| 2.3-09 Windows System Telemetry | Highest-priority operator-value work |
| 2.3-10 Agent Diagnostics | Reduce to useful logs, failure context, version, and redacted export |

## Version 2.4 direction

# Version 2.4 - Field Tools

After the Single-Operator Field MVP is released, the next release should be dominated by operator-facing tools. Candidate priorities include:

- Field Tools workspace
- Maidenhead and coordinate conversion
- distance and bearing calculations
- SOTA summit lookup and activation support
- POTA park lookup and activation support
- sunrise, sunset, and twilight
- radio and antenna references
- operating and deployment checklists
- activation notes and quick log
- offline reference caching

The final sequence should be chosen by expected use on the next several field outings.

### Approved Version 2.4 product interpretation

POTA/SOTA activation support remains the Version 2.4 Field Tools capability. **SmartDeploy is the bounded operator workflow through which activation support becomes useful; it does not replace POTA/SOTA and does not redefine Version 2.4 as the full Field Operations Assistant.**

The first activation-planning implementation slice is **POTA-first** because an individual-target source has already been researched and provides a concrete workflow for field validation. This is implementation sequencing, not a permanent architectural limitation: the core planning concept must remain capable of supporting SOTA later.

The operator problem for this slice is **activation planning**, not an isolated park lookup or propagation calculator. Target lookup is an input, and propagation is planning intelligence consumed by the workflow.

### POTA Activation Planning / SmartDeploy Slice 1

The candidate first slice is a coherent, reviewable activation-planning workflow:

```text
POTA target
	-> operating location
	-> mission start and end
	-> operator-entered radio / antenna / mode / power context
	-> mission-window propagation/model intelligence
	-> distance and bearing
	-> solar/twilight context
	-> trust, provenance, and limitations
	-> SmartDeploy planning brief
	-> locally retained field-use result
```

Mission time is first-class. The workflow captures a bounded planned operating window with a start and end, and planning intelligence is evaluated for that window wherever the underlying capability supports it. Existing model-time inputs should eventually be supplied from the mission window rather than silently treating current time as mission time; this planning decision does not reopen or modify propagation implementation.

The initial equipment context is deliberately thin: the operator states, “I am taking this equipment; build my plan around it.” It may include radio, antenna, allowed or preferred modes, intended transmit power, and deployment configuration only where meaningful and explicitly entered. Version 2.4 does not select, optimize, or recommend the operator's equipment.

Planning may require connectivity, but field use of the generated plan must not require continuous connectivity. The first brief is therefore locally retained for later offline use. This establishes a product requirement without selecting a final persistence or database architecture.

The slice should reuse existing coordinate, Maidenhead, distance/bearing, solar/twilight, observed-RF, P.533, station-profile, logging, and trustworthy-status capabilities. Observed-RF evidence is observational evidence only and must not be presented as a forecast for a future mission. New weather-forecast or space-weather-forecast provider work is not a prerequisite for this first slice; those intelligence classes may be added later without blocking it.

The first brief is deterministic and evidence-grounded. Operator-entered antenna facts may be used as context, but unsupported exact azimuth, apex height, topology, or site-specific deployment advice is not generated. AI is not required; any later AI must synthesize structured evidence and must not supply operational facts of its own.

### Version 2.4 and Version 2.5 boundary

The following remain deferred to the later Field Operations Assistant work: persistent full equipment inventory, reusable loadouts, automatic equipment selection, loadout optimization, full mission lifecycle/state management, full power/endurance optimization, broad antenna deployment optimization, autonomous operating-plan generation, generalized AI operations assistance, true path prediction, activation submission or spotting, generalized provider platforms, and enterprise/multi-user/fleet architecture.

Only the minimum bounded concepts required to complete the POTA activation-planning slice may be pulled forward. SmartDeploy Slice 1 is a planning workflow and locally retained brief, not authorization for the complete Version 2.5 assistant roadmap.

## Backlog scoring requirements

Future backlog reviews should include:

- operator value, 1-5;
- enabling necessity, 1-5;
- current deployment relevance;
- estimated effort;
- target release;
- defer decision;
- named user-facing capability enabled.

High complexity without near-term field value should not silently become high priority.

## Resource-allocation guideline

For normal planning, excluding urgent vulnerability fixes:

- 60% operator-facing capability
- 25% integration and reliability
- 10% testing and documentation
- 5% additional hardening beyond the existing baseline

## Review gate

Before starting a major task, answer:

1. What operator problem does this solve?
2. Will the improvement be visible in the current or next release?
3. Is the task required to preserve trustworthy behavior?
4. Can it safely wait until after the MVP?
5. Is its security scope proportionate to the actual deployment?

## Bottom line

The foundation is sufficient to proceed. The project will preserve the framework already built, stop extending speculative platform capability on the active path, finish a usable single-operator product, and then invest primarily in Field Tools and iterative field refinement.

## Version 2.3 Closure Note - 2026-08-14

The approved Version 2.3 sequence is complete:

1. Freeze and document this rebaseline. **Complete**.
2. Finish only the tray behavior required for normal single-operator use. **Complete**.
3. Confirm the minimal loopback integration path from dashboard/backend to agent. **Complete**.
4. Implement serial-port enumeration. **Complete**.
5. Implement the NMEA GNSS adapter. **Complete**.
6. Implement Windows system telemetry. **Complete**.
7. Consolidate startup, deployment, update, and uninstall. **Complete**.
8. Perform operational ToughBook/ToughPad validation. **Complete**.

Operational validation passed on the production Panasonic ToughBook CF-20. Version 2.3 is release-ready pending merge, tag, and release mechanics. Deferred enterprise and hardening work remains deferred under the approved rebaseline. The next planned product release is Version 2.4 - Field Tools.

## Activation Notes / Quick Log Closure Note - 2026-08-19

Activation Notes / Quick Log, the bounded SmartDeploy brief-associated timestamped note capability from the Version 2.4 candidate list, is complete for its approved scope:

1. Schema and local persistence foundation. **Complete**.
2. Server API and SmartDeploy brief association. **Complete**.
3. Minimum operator UI. **Complete**.
4. ToughBook deployment and field validation. **Complete**.

Deployment and field validation passed at revision `384c0c8e4460c354614ac6ffc6553573161a0c43`. See [Version 2.4 Activation Notes Field Validation](../validation/Version-2.4-Activation-Notes-Field-Validation-2026-08-19.md) for the recorded evidence, including a deferred, non-blocking updater-hardening observation about non-elevated `UpdateDashboard.ps1` invocation.

Activation Notes / Quick Log remains explicitly bounded: it is not a QSO logger, not ADIF, not spotting or submission, not an activation lifecycle framework, and not Version 2.5 Field Operations Assistant behavior. Selecting the next Version 2.4 Field Tools priority remains a separate decision.

## Field Readiness Checklist Closure Note - 2026-08-20

Field Readiness Checklist, the bounded SmartDeploy brief-associated operating checklist from the Version 2.4 candidate list, is complete for its approved scope:

1. Checklist model and local persistence foundation. **Complete**.
2. Server API and immutable SmartDeploy brief association. **Complete**.
3. Minimum operator UI. **Complete**.
4. ToughBook deployment and field validation. **Complete**.

Deployment and field validation passed at revision `2272c5a3702d22a253bc52c8a3a434548a3f27ae`. See [Version 2.4 Field Readiness Checklist Field Validation](../validation/Version-2.4-Field-Readiness-Checklist-Field-Validation-2026-08-20.md) for the recorded evidence, including offline persistence, brief isolation, reset confirmation, and no observed SmartDeploy or Activation Notes regression.

Field Readiness Checklist remains explicitly bounded: it is not mission lifecycle or status, equipment inventory or loadouts, QSO logging or ADIF, spotting or submission, user-authored checklist templates, or AI operations assistance. Selecting another Version 2.4 Field Tools priority remains a separate decision.
