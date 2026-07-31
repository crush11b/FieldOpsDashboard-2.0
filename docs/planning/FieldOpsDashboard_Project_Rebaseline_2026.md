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
