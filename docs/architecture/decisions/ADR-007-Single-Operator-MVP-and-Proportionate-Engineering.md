# ADR-007: Single-Operator MVP and Proportionate Engineering

- Status: Accepted
- Accepted: 2026-07-31
- Supersedes: None
- Superseded by: -
- Decision owners: FieldOps Dashboard maintainers
- Related planning: `docs/planning/FieldOpsDashboard_Project_Rebaseline_2026.md`

## Context

FieldOps Dashboard was created to provide trustworthy, useful field-operating information and tools on rugged Windows hardware. Versions through 2.2 established honest telemetry semantics, a local backend, and a Windows Local Agent foundation.

During Version 2.3 work, implementation and validation expanded into enterprise-style identity provisioning, multiple Windows accounts, separate-session behavior, generalized credential lifecycle, packaging, signing, and broad security hardening. Those concerns are valid for future wider deployment, but they began consuming disproportionate time and budget while the primary operator still lacked a completed usable product.

The current real deployment is one primary operator using one locally operated ToughBook or ToughPad. Communication remains local and loopback-only. There is no current requirement for fleet management, domain integration, remote administration, or simultaneous multi-user operation.

The project needs to preserve the architecture already built without allowing speculative framework completion to continue blocking operator-facing value.

## Decision drivers

- Deliver a usable product within constrained time and development budget.
- Preserve trustworthy telemetry and honest failure behavior.
- Keep reliable Windows service lifecycle and local hardware integration.
- Prioritize capabilities used during actual field operations.
- Maintain security controls proportionate to the real deployment.
- Avoid abandoning work that may support future broader distribution.
- Generalize architecture only after multiple concrete use cases justify it.

## Decision

The primary supported deployment for the current roadmap is a **single operator on one locally operated Windows field computer**.

The project will pursue a **Single-Operator Field MVP** before further enterprise-style hardening. Existing architecture decisions remain accepted, but only the portions required by current clients and current capabilities are implemented on the active path.

### Active priorities

1. Operator-facing field value
2. Trustworthy and non-fabricated information
3. Reliable startup, recovery, update, and offline operation
4. Real GNSS and Windows system telemetry
5. Practical ToughBook/ToughPad deployment and field validation
6. Field Tools development and iterative refinement

### Security baseline retained now

- agent binds only to loopback;
- local agent health and approved client calls remain authenticated;
- agent does not enable wildcard CORS;
- browser storage does not contain reusable agent credentials;
- read-only telemetry remains separated from privileged operations;
- the service continues to use a restricted Windows service identity;
- secrets remain protected and excluded from logs and diagnostics;
- discovered critical vulnerabilities remain eligible for immediate correction.

### Work deferred from the active release path

- alternate-user and simultaneous-session support;
- Fast User Switching and RDP validation;
- generalized local role and group provisioning;
- enterprise credential rotation, revocation, and pairing workflows;
- broad privileged-operation APIs;
- code-signing infrastructure;
- polished enterprise installer behavior;
- fleet deployment and centralized policy;
- remote administration;
- advanced audit and support-bundle frameworks.

Deferred work remains documented in a future hardening or enterprise backlog. It is not rejected permanently.

### Architecture-generalization rule

Infrastructure may be generalized when at least two real implemented capabilities require the abstraction, or when a current release acceptance criterion cannot be met safely without it.

A future hypothetical consumer is not, by itself, sufficient justification.

### Release admission rule

A task may block the current release only when it:

- provides a capability the operator will use;
- prevents misleading or unsafe product behavior;
- is required for reliable local operation;
- directly enables a named current or next-release field feature; or
- mitigates a realistic threat for the present deployment.

## Version 2.3 consequence

Version 2.3 is redefined as **Single-Operator Field MVP**.

The release focuses on:

- normal operator tray startup, service status, Open Dashboard, and clean Exit;
- minimum loopback dashboard/backend-to-agent integration;
- serial-port enumeration;
- NMEA GNSS integration;
- Windows battery and system telemetry;
- practical startup, deployment, update, and uninstall;
- representative ToughBook/ToughPad operational validation.

Multi-user, enterprise, signing, and generalized platform work do not block Version 2.3.

## Relationship to existing ADRs

### ADR-001: Windows Service Runtime

Remains accepted. The .NET Windows service provides useful lifecycle, recovery, and hardware-integration capabilities. This ADR limits speculative expansion of the service platform; it does not replace the selected runtime.

### ADR-002: Agent Transport and Authentication

Remains accepted. Loopback-only authenticated transport, protected credentials, and browser/privileged-client separation remain valuable. Generalized credential lifecycle, multiple client scopes, and future privileged APIs are implemented only when a current capability requires them.

### ADR-003: Tray Companion Technology and Service Control

Remains accepted. Normal single-operator tray behavior is the current acceptance target. Separate-session coexistence and alternate-user lifecycle validation are deferred.

### ADR-006: Dashboard Backend Ownership

Remains accepted. The local backend continues to own browser-facing integration, external-source adapters, configuration, and constrained agent access. New backend infrastructure must still justify itself through a named product capability.

## Consequences

### Positive

- usable releases arrive sooner;
- development spending shifts toward field value;
- field feedback can guide later architecture;
- the existing trustworthy foundation is preserved;
- speculative complexity is reduced;
- enterprise work remains available when actual demand appears.

### Negative

- wider distribution will require later hardening and validation;
- some generalized mechanisms will be implemented incrementally;
- multi-user environments are not fully supported by the MVP;
- deferred security and packaging work must be revisited before claiming enterprise readiness.

These tradeoffs are accepted because the current objective is a dependable locally operated product, not an enterprise platform.

## Review triggers

Reconsider this decision when one or more of the following becomes true:

- more than one regular operator must use the same installation;
- the product is distributed broadly to unrelated users;
- remote or LAN access is introduced;
- managed organizational deployment becomes a real requirement;
- privileged operations expand materially;
- signing or installer reputation becomes an operational blocker;
- field experience demonstrates that a deferred framework capability is necessary for reliability or safety.

Until then, project sequencing should follow the approved 2026 rebaseline.
