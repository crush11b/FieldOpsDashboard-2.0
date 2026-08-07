# Windows Location Broker ToughBook Validation

Status: **NOT RUN**. This procedure requires the representative ToughBook, an interactive
operator session, Windows consent UI, and location-capable hardware. Automated tests mock the
Windows API adapter and exercise the real tray-to-Agent pipe, but cannot validate Windows consent
presentation or physical fix acquisition.

## Preconditions

1. Sign in to the ToughBook as the normal `stick` operator.
2. Confirm Windows Location Services and the hardware location sensor are installed.
3. Build and deploy the new self-contained Agent and Tray artifacts using the supported deployment
   process. Confirm the Agent runs as `NT AUTHORITY\LOCAL SERVICE` and the tray runs as `stick`.
4. Open Event Viewer and identify the FieldOps Agent application-event source. Identify any tray
   diagnostic output configured for the validation machine.
5. Obtain the existing Agent API bearer credential using the supported protected credential flow;
   do not copy it into the tray or location-broker configuration.

## Acceptance procedure

1. Start `FieldOps.Tray.exe` as `stick`. Confirm exactly one tray icon appears and the Agent service
   remains running as LocalService.
2. Before granting consent, call authenticated `GET http://127.0.0.1:43120/api/v1/location`.
   Confirm HTTP 200 JSON reports `PermissionDenied` with every telemetry field `null`.
3. Open the tray menu and select **Enable Windows Location**. Confirm the Windows permission prompt
   is presented in the interactive `stick` session. Approve it once. Confirm the tray reports that
   Windows location is enabled and does not present repeated automatic prompts.
4. Move to a location with adequate reception and call the Agent endpoint again. Confirm it reports
   `Available`, non-null latitude/longitude sourced from Windows, an honest Windows timestamp, and
   only those optional altitude/accuracy/speed/heading values supplied by Windows. Record pass/fail,
   but do not paste coordinates into the validation record.
5. In Windows **Settings > Privacy & security > Location**, revoke location access for the relevant
   desktop application context (or disable device Location Services). Call the endpoint and confirm
   `PermissionDenied` or `Disabled`, respectively, with all telemetry fields `null`.
6. Restore access, exit the tray, and restart the Agent service. Start the tray again as `stick`.
   Select **Enable Windows Location** once to re-establish the tray session state. Confirm Windows
   honors its persisted consent decision without an unnecessary repeated consent prompt, then
   confirm the Agent endpoint again returns an honest fix or acquisition state.
7. Stop the tray and call the endpoint. Confirm `Unavailable` after the bounded connection attempt.
   Restart the tray and confirm recovery without restarting the Agent.
8. Exercise a poor-reception condition. Confirm `Initializing`, `NoFix`, or the bounded timeout
   result is returned; zero coordinates must never be substituted.
9. Review Windows Event Viewer, Agent logs, tray diagnostic output, and generated diagnostics for
   latitude, longitude, altitude, heading, speed, and the observed coordinate strings. Confirm no
   coordinates or location history were logged or retained.
10. Record Windows build, hardware model, sensor/driver identity, Agent/Tray artifact manifest,
    consent decisions, endpoint statuses, restart behavior, and log-audit result. Do not record the
    physical coordinates.

## Pass criteria

- Consent is initiated only by the explicit tray action in the interactive operator context.
- The tray owns `FieldOps.LocationBroker.v1`; LocalService can connect, while broad local groups and
  remote/anonymous identities are not authorized.
- The browser receives location only through the authenticated Agent endpoint.
- Revocation, disabled service, no fix, timeout, tray absence, and restart behavior remain honest.
- No coordinate or location-history data appears in logs or retained files.
