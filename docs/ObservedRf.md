# PSKReporter MQTT Observed-RF Foundation

FieldOps receives observed digital reception reports through the third-party MQTT distribution service `mqtt.pskreporter.info`. The underlying feed originates from PSKReporter and is used with permission; the broker is not represented as official PSKReporter infrastructure.

## Transport and subscriptions

The server uses MQTT.js over encrypted WebSocket transport:

- Broker: `wss://mqtt.pskreporter.info:1886/mqtt`
- Sender grid: `pskr/filter/v2/+/+/+/+/{GRID4}/+/+/+`
- Receiver grid: `pskr/filter/v2/+/+/+/+/+/{GRID4}/+/+`

The service maintains one connection and two subscriptions for the current four-character operating grid. The grid is derived from the current operating coordinates using the existing Maidenhead utility. An unavailable operating location does not subscribe to a default grid.

## Evidence semantics

Reports are normalized as observed digital reception-report activity. They do not prove SSB usability, station-specific success, regional openness, confidence, ratings, or modeled propagation results. A connected broker with no reports is a live source with zero matching digital reports, not an unavailable source.

Reports are retained in a fifteen-minute rolling window. Source observation time is kept separately from MQTT receipt time; missing, invalid, negative, or materially future source timestamps are rejected. The latest useful snapshot is persisted atomically server-side with the observation window and explicit proof that MQTT was live during collection. A recent valid cache, including a valid zero-report collection, is `cached`; an expired valid cache is `stale`; an empty or unproven cache is `unavailable`. MQTT disconnects retain the current window while bounded reconnect backoff runs.

The optional diagnostic endpoint is `GET /api/observed-rf`. Production UI and regional/P.533/NOAA synthesis are intentionally not connected in this slice.
