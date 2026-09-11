# ADR-009: Reliable Launcher Protocol

- Status: Accepted for V2.9-02
- Date: 2026-09-10
- Scope: Dashboard-to-Tray launcher protocol

## Decision

V2.9-02 replaces the v1 launcher pipe with protocol version 2 at `FieldOps.Tray.Launcher.v2`. The Dashboard and Tray do not fall back to v1. This prevents an older Tray from accepting a request while silently ignoring arguments or a working directory. A missing protocol version is malformed; an unsupported nonzero version is reported as incompatible.

Requests remain length-prefixed JSON frames with a positive bounded little-endian length. The maximum launcher message is 8192 bytes. Request and response shapes reject unknown members, invalid enums, malformed strings, trailing data, truncated data, and oversized frames. The local named-pipe authorization boundary remains unchanged.

A v2 request contains `ProtocolVersion`, `LaunchType`, and `Target`. Native executable requests may also contain `Arguments` (a bounded string vector) and `WorkingDirectory`. The Dashboard adapts the existing configured `args` string using a deliberately narrow quoting grammar: spaces and tabs separate arguments outside quotes; quotes toggle quoted mode; an odd run of backslashes immediately before a quote emits paired backslashes plus a literal quote; an even run emits paired backslashes and toggles quoted mode. Adjacent quoted and unquoted segments are one argument. Empty quoted segments are valid, and unterminated quotes or NULs are rejected. This grammar is tested as its own configuration contract and is not claimed to be a general Windows command-line parser. The Tray passes each argument through `ProcessStartInfo.ArgumentList` with `UseShellExecute=false`.

## Approved target contract

- Native targets are fully qualified local drive paths ending in `.exe`; UNC, relative, quoted, NUL-containing, malformed, and other target types are rejected on both sides.
- Web targets are absolute HTTP or HTTPS URIs with a host. They use the Windows browser association and cannot carry native arguments or a working directory.
- A supplied working directory is a fully qualified local drive directory without quotes or NULs. The Tray verifies it exists immediately before launch. When omitted, the executable's containing directory is used. Missing or invalid directories are reported separately.
- The Tray verifies executable existence immediately before launch. A successful native result means only that Windows accepted the process request; it does not claim process initialization.

The browser sends only an approved application ID. The local Express route resolves that ID from trusted configuration and constructs the v2 request. Browser-supplied target, arguments, and working-directory fields are not accepted. The Express server never launches native processes.

## Outcomes and exclusions

Typed results distinguish accepted native launch, accepted URI open, executable not found, invalid request, launch failure, busy, protocol incompatibility, invalid working directory, launcher unavailability, and launcher protocol error. Connection failure, closed pipe, and timeout map to launcher unavailability. Invalid framing, malformed JSON, unknown response members, invalid result codes, oversized details, trailing bytes, and locally oversized request payloads map to launcher protocol error or invalid request without exposing exception text or sensitive paths.

This decision does not authorize discovery, installation, shell commands, `cmd.exe`, PowerShell, shell handlers, shortcuts, JARs, documents, directories as targets, installers, CAT/PTT/tuning, radio control, spotting, submission, catalog persistence, catalog UI, or curated migration.
