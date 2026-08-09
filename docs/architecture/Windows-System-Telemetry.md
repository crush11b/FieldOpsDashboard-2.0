# Windows system telemetry (2.3-09 slice)

The first 2.3-09 slice owns battery and power observations in the Windows Agent. `GetSystemPowerStatus` supplies charge, AC/battery state, charging flag, and the Windows-reported remaining lifetime when available. Unsupported values remain nullable; no runtime is inferred from charge percentage.

The Agent exposes the observation through `FieldOps.SystemTelemetry.v1`; Express reads that local pipe at `/api/system`, and the Dashboard treats it as authoritative. Browser Battery API data is not used as a production fallback when native telemetry is unavailable. CPU, memory, storage, and network remain outside this slice.
