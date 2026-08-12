# Windows system telemetry (2.3-09 slice)

The 2.3-09 slice owns battery, power, CPU, and memory observations in the Windows Agent. `GetSystemPowerStatus` supplies charge, AC/battery state, charging flag, and the Windows-reported remaining lifetime when available. `GetSystemTimes` supplies a bounded system-wide CPU sample, while `GlobalMemoryStatusEx` supplies total, available, and derived used physical memory. Unsupported or failed values remain nullable; no runtime or CPU value is inferred from unrelated fields.

The Agent exposes the observation through `FieldOps.SystemTelemetry.v1`; Express reads that local pipe at `/api/system`, and the Dashboard treats it as authoritative. Browser Battery API data is not used as a production fallback when native telemetry is unavailable. Storage and network remain outside this slice.
