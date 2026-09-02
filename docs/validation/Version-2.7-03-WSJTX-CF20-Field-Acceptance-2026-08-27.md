# Version 2.7-03 WSJT-X CF-20 Field Acceptance

- Date: 2026-08-27
- Hardware: Panasonic ToughBook CF-20 Mk2
- Software: WSJT-X v3.0.0-rc1; FieldOps Dashboard Version 2.7 development branch
- Dashboard revision: `a4726c847e2a29629ca8bff8812cb0e6fa92de6f`
- Result: **VERSION 2.7-03 CF-20 HARDWARE ACCEPTANCE: PASS**

## WSJT-X configuration

- `UDPServer=127.0.0.1`
- `UDPServerPort=2237`
- `AcceptUDPRequests=true`

FieldOps owned the local UDP listener at `127.0.0.1:2237`. The browser continued to use the same-origin `GET /api/wsjtx/current` route; it did not listen for UDP.

## Acceptance sequence

1. With WSJT-X closed, CURRENT STATION correctly showed the retained manual context: `20m / SSB`.
2. WSJT-X was started on `20m / FT8 / 14.074 MHz`.
3. Before the protocol correction, `GET /api/wsjtx/current` returned `status=unavailable`, `state=null`, and `limitation="No WSJT-X Status message has been received."` even though FieldOps owned `127.0.0.1:2237`.
4. Field acceptance established that the original synthetic tests modeled the WSJT-X wire protocol incorrectly.
5. Revision `a4726c847e2a29629ca8bff8812cb0e6fa92de6f` (`fix: parse real wsjt-x network messages`) corrected the real 12-byte message header, `quint32` message type, schema 2/3 compatibility, unsigned safe `quint64` frequency handling, nullable UTF-8/QByteArray semantics, and malformed/truncated packet handling.
6. After redeployment from `a4726c8`, live endpoint evidence returned:

```json
{
  "kind": "wsjtx_station_state",
  "status": "available",
  "state": {
    "band": "20m",
    "frequencyMHz": 14.074,
    "mode": "FT8",
    "source": "wsjtx",
    "observedAtUtc": "2026-08-27T17:43:19.305Z",
    "freshness": "fresh",
    "status": "available",
    "limitation": "WSJT-X application status; not CAT, direct radio, or RF confirmation."
  },
  "receivedAtUtc": "2026-08-27T17:43:19.305Z",
  "limitation": "WSJT-X application status; not CAT, direct radio, or RF confirmation."
}
```

7. CURRENT STATION automatically changed from the retained manual context to the live WSJT-X context.
8. Changing the operating context in WSJT-X was automatically followed by CURRENT STATION without touching the FieldOps QSO Logger.
9. WSJT-X was closed.
10. After the freshness interval expired, CURRENT STATION stopped using WSJT-X evidence and fell back to the retained manual operating context.

## Acceptance conclusion

The 2.7-03 CF-20 acceptance passed. The observed WSJT-X state is application-reported operating context with bounded freshness. It is not CAT evidence, direct-radio confirmation, transmit confirmation, or RF confirmation. No CAT, radio-control, PTT, or transmit integration is claimed.

The existing limitation language remains authoritative:

> WSJT-X application status; not CAT, direct radio, or RF confirmation.

## GNSS recovery observation

During the same acceptance session, the CF-20 GNSS stopped emitting NMEA:

- FieldOps Agent remained healthy.
- `/api/location` reported `SerialNmea / NoFix`.
- Restarting FieldOps Agent did not recover GNSS.
- A direct COM6 read opened successfully but timed out with no NMEA.
- Panasonic GPS Viewer opened COM6 but received no information.
- A full ToughBook reboot restored GPS.

This is classified as a hardware, driver, or GNSS-device recovery observation and an accepted operational limitation for this session. It is not attributed to Version 2.7-03 or the WSJT-X integration. COM6 was available/openable, but the underlying GNSS device was not emitting NMEA; therefore an Agent restart could not recover the signal. No GNSS implementation change is part of this acceptance record.

## Scope boundary

This record closes the 2.7-03 WSJT-X read-only field acceptance. It does not close the broader Version 2.7 release gate in 2.7-07, which separately requires full lifecycle validation including a supported logged-QSO event, observed-RF behavior, GNSS and clock readiness, offline behavior, and REVIEW retention.
