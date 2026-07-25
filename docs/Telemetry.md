# Telemetry Architecture

This document describes the telemetry foundation introduced by E1-001 and its first integration in E1-002. It is the reference for contributors migrating additional dashboard data sources.

## Purpose

FieldOps receives data from hardware, local scripts, browser APIs, remote services, caches, and simulated fallbacks. Those sources have different freshness and failure characteristics. The telemetry system gives them a shared transport contract so consumers can determine what data is available, where it came from, when it was observed, and whether it is live, degraded, stale, unavailable, or failed.

Telemetry metadata is additive. Domain payloads remain responsible for describing battery, GPS, weather, radio, or other measurements.

## TelemetryEnvelope

`TelemetryEnvelope<TPayload>` is defined in `src/telemetry/TelemetryEnvelope.ts` and exported through `src/telemetry/index.ts`. It is a readonly discriminated union with four state families:

- Live states (`ok`, `degraded`) require `data` and prohibit `error`.
- Retained states (`stale`, `cached`) may include `data` and prohibit `error`.
- Pending states (`connecting`, `unavailable`) may omit `data` and prohibit `error`.
- The `error` state requires structured `TelemetryError` metadata and may retain a last-known payload.

Every envelope contains a lifecycle `status`, `source` identity, and timestamps. `observedAt` describes when the reading was observed, while `receivedAt` describes when the envelope boundary received or created the representation. An optional `expiresAt` can make the freshness boundary explicit. Envelope-level `metadata` may carry transport or processing context.

The model is compile-time only. Runtime validation is intentionally outside the scope of E1-001 and E1-002.

## Status semantics

### `ok`

Use when a current reading was obtained successfully from an authoritative live source. Examples include a successful WMI poll, Linux sysfs read, or recently pushed local-agent reading.

### `degraded`

Use when a payload remains usable but has reduced authority, precision, or completeness. Current battery simulation fallbacks use this status because they provide display-safe values rather than hardware observations.

### `stale`

Use when a previously live reading has exceeded its freshness window but is retained for continuity. A stale envelope should normally keep its last-known payload so the UI does not reset abruptly.

### `connecting`

Use while a source is initializing or its first reading is pending. A payload is optional because no prior reading may exist.

### `unavailable`

Use when a source cannot currently provide a reading and no failure requiring structured error metadata is being reported. A last-known payload may be included when useful.

### `error`

Use when acquisition or processing failed. The envelope must include `TelemetryError` with a stable code, a meaningful message, and whether retrying is reasonable.

### `cached`

Use when a deliberately persisted or cached reading is served instead of a live result. Do not use `cached` merely because an in-memory reading has aged; that condition is `stale`.

## Why the backend creates envelopes

The backend owns authoritative envelope creation because it selects and normalizes sources. It knows whether a result came from pushed telemetry, direct hardware polling, a remote service, a cache, or a fallback. It also owns server receipt time, freshness policy, and structured acquisition errors.

Producers should report observations, not reproduce dashboard policy. Requiring PowerShell scripts, serial agents, and remote integrations to assign statuses would duplicate logic and allow identical readings to receive conflicting classifications. The frontend consumes status and source metadata rather than inferring health from payload values.

## Current battery implementation

E1-002 wraps the existing `DualBatteryStatus` payload model rather than introducing another battery model.

The legacy `GET /api/system/battery` endpoint remains unchanged. It selects among pushed ToughBook agent telemetry, Windows `Win32_Battery`, Linux `/sys/class/power_supply`, and simulated fallbacks.

The new `GET /api/telemetry/battery` endpoint adapts that result into `TelemetryEnvelope<DualBatteryStatus>`:

- Recent `local_telemetry_agent` data is `ok`.
- `win32_wmi` and `linux_sysfs` readings are `ok`.
- Sources beginning with `simulated_` are `degraded`.
- Pushed agent data older than 15 seconds is `stale` and retains its payload.
- Endpoint failures produce an `error` envelope.

`BatteryStatusWidget` is the only migrated consumer. It requests `/api/telemetry/battery`, unwraps `envelope.data`, and applies the existing state merge. `App.tsx`, `HeaderBar`, `DualBatteryStatus`, rendering, browser fallback, manual controls, and PowerShell producers remain unchanged.

PowerShell producers continue posting their compact legacy payloads to `/api/system/battery/telemetry`. The backend remains responsible for normalization and envelope creation.

## Endpoint migration strategy

Telemetry endpoints are introduced alongside legacy system endpoints:

```text
/api/system/battery      -> legacy flat response
/api/telemetry/battery   -> TelemetryEnvelope<DualBatteryStatus>
```

For later migrations, keep the existing endpoint stable, add `/api/telemetry/<domain>` as an envelope adapter, migrate one frontend consumer at a time, and preserve producer inputs during the transition. Remove or redirect a legacy endpoint only in an explicitly planned breaking-change ticket.

Avoid duplicating domain models solely for transport migration. Wrap the established payload type first, then improve that payload independently when justified.

## Freshness policy

Freshness is source-specific and belongs in the backend.

Battery agent scripts normally post every five seconds. E1-002 marks only pushed `local_telemetry_agent` readings stale after 15 seconds, allowing two missed updates before changing status. The threshold does not apply to WMI or sysfs because those sources are polled on demand for each request.

For current pushed battery data, `observedAt` is the server ingestion time because existing PowerShell producers do not send a device timestamp. `receivedAt` records envelope creation time. Future producers may supply an observation timestamp, but the backend must normalize and sanity-check it before use.

New domains must define freshness from their expected cadence and operational needs. Do not reuse the battery threshold automatically. Where useful, populate `expiresAt` so consumers can understand the boundary without duplicating backend constants.

## Layer responsibilities

### Producers

- Read hardware or upstream services.
- Send measurements and source-native timestamps when available.
- Use stable field names and units.
- Remain independent of frontend presentation.
- Do not assign dashboard lifecycle statuses unless their protocol requires it.

### Backend

- Accept and normalize producer formats.
- Select the authoritative source or fallback.
- Create `TelemetryEnvelope` instances and assign status.
- Record source identity and timestamps.
- Apply domain-specific freshness rules.
- Return structured errors without disguising failures as live readings.
- Preserve compatibility endpoints during staged migrations.

### Frontend

- Request `/api/telemetry/*` endpoints.
- Narrow behavior using `envelope.status`.
- Render `envelope.data` through existing domain view models.
- Preserve useful stale or cached data where appropriate.
- Present degraded, unavailable, or error conditions without inventing source semantics.
- Retain browser-only fallbacks only where the feature explicitly supports them.

## Future domain migrations

GPS, Weather, APRS, Radio, Solar, propagation, and later sources should follow the battery sequence:

1. Identify the established payload type and every producer and consumer.
2. Define source identifiers and the domain freshness policy.
3. Add `/api/telemetry/<domain>` returning `TelemetryEnvelope<ExistingPayload>`.
4. Map live, fallback, retained, unavailable, and error paths explicitly.
5. Migrate the narrowest frontend consumer while keeping its rendering model stable.
6. Test live, stale, degraded, and failed paths independently.
7. Retire legacy transport only after all consumers are known to have moved.

Example source mappings include:

- GPS: `serial_nmea`, `browser_geolocation`, `local_telemetry_agent`, `manual_location`.
- Weather: `nws`, `open_meteo`, `cached_forecast`, `simulated_weather`.
- APRS: `direwolf`, `kiss_tnc`, `aprs_is`, `cached_packets`.
- Radio: `hamlib`, `rigctld`, `serial_cat`, `manual_frequency`.
- Solar: `noaa_swpc`, `cached_solar`, `modeled_solar`.

Source type and status are separate concepts. A source name must not determine status unless its backend adapter deliberately defines that mapping.

## Examples

### Live WMI battery reading

```ts
const live: TelemetryEnvelope<DualBatteryStatus> = {
  status: 'ok',
  source: {
    id: 'win32_wmi',
    type: 'win32_wmi',
    name: 'Dual Battery System',
  },
  timestamps: {
    observedAt: '2026-07-25T14:30:00.000Z',
    receivedAt: '2026-07-25T14:30:00.000Z',
  },
  data: {
    powerSource: 'Battery',
    mainTablet: {
      percent: 82,
      charging: false,
      voltage: 11.8,
      health: 'Good',
      tempC: 28,
      timeRemainingMins: 287,
    },
    keyboardDock: {
      percent: 64,
      charging: false,
      voltage: 12.1,
      health: 'Good',
      tempC: 26,
      timeRemainingMins: 269,
      attached: true,
    },
  },
};
```

### Stale pushed reading

```ts
const reading: TelemetryEnvelope<DualBatteryStatus> = {
  status: 'stale',
  source: {
    id: 'local_telemetry_agent',
    type: 'local_telemetry_agent',
  },
  timestamps: {
    observedAt: '2026-07-25T14:30:00.000Z',
    receivedAt: '2026-07-25T14:30:18.000Z',
  },
  data: lastKnownBattery,
};
```

### Structured failure

```ts
const failure: TelemetryEnvelope<DualBatteryStatus> = {
  status: 'error',
  source: {
    id: 'system_battery',
    type: 'system_battery',
  },
  timestamps: {
    observedAt: now,
    receivedAt: now,
  },
  error: {
    code: 'BATTERY_QUERY_FAILED',
    message: 'Battery query failed',
    retryable: true,
  },
};
```

Consumers must narrow on `status` and check whether retained or pending states include `data`. They must not assume every successful HTTP response contains a live reading.
