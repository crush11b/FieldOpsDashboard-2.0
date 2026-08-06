# Serial-port enumeration (2.3-07A)

The Local Agent exposes the authenticated, read-only `GET /api/v1/serial-ports` contract. It uses `System.IO.Ports.SerialPort.GetPortNames()` only for presence and stable COM names; enumeration never opens a port, probes baud rates, changes configuration, or sends bytes. Missing device metadata remains null rather than fabricated.

The dashboard presents a small Serial ports panel with count, COM names, available metadata, honest unavailable/error states, last refresh time, and a manual Refresh action. It refreshes every 30 seconds. Zero ports is a successful empty result.

This first slice does not implement GNSS/NMEA, device selection, arrival events, or hardware validation. The ToughBook procedure is: record baseline; plug in a known USB serial device; confirm the new COM port appears; unplug it; confirm it disappears; compare friendly name and identifiers with Device Manager; verify no device is opened or disrupted and the dashboard remains responsive. Use any known USB-to-serial adapter or field radio interface available on the test machine; do not assume a particular device is attached.
