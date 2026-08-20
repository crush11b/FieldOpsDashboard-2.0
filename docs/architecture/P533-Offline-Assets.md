# Offline P.533 Assets

FieldOps provisions the ITU-R P.533-14 / ITU-R-HF v14.3 runtime through
`npm run p533:provision`. Provisioning is the only networked operation. It
downloads the pinned OpenHamClock WASM release assets and the complete
`p533-data-v14.3` release, verifies every SHA-256 digest, decompresses the 25
model files into `p533-assets/runtime`, and writes local installed-file hashes
to `provenance.json`.

The normal `npm run build` requires `npm run p533:verify` to pass, copies the
verified runtime into `public/p533`, and verifies the resulting `dist/p533`
bundle before completing. Runtime code has a local filesystem locator only; it
does not download P.533 code or data.

The Node executor loads `p533.mjs` through a local file URL and supplies the
verified `p533.wasm` bytes as `wasmBinary`. It creates `/data` and `/tmp` in
Emscripten MEMFS, copies only the requested month plus the P.1239 decile
factors into `/data`, writes `/input.txt`, calls `callMain`, and parses the
generated `/tmp/output.txt`. Calls are serialized because the engine reuses a
single MEMFS instance. This boundary is server-only and has no runtime fetch,
browser API, native executable, or heuristic fallback.

Slice 5E evaluates every Slice 5C representative sample against all nine
`P533_SUPPORTED_BANDS` sequentially. The regional runner preserves each raw
report and normalized per-sample result, then computes minimum, maximum, and
median numeric summaries from successful samples only. It consumes the
persisted `DashboardConfig.propagation.stationProfile`; the selected mode,
antenna, and deployment remain metadata while this slice uses an explicit
provisional isotropic reference antenna, 3000 Hz bandwidth, 15 dB required
SNR, 90% required reliability, residential noise, and analog modulation.
No antenna gain adjustment or final mode-specific claim is made. `6m` is
explicitly unsupported by P.533, and `local_nvis` returns
`separate_evaluator_required` semantics rather than fabricated endpoints.

When a reused Emscripten module emits only the calculated row and terminator
after its first call, the parser uses the fixed requested report column order
and retains that compact raw report. Partial and unavailable regional results
retain every failed sample and never replace failures with zeroes or ratings.

The generated bundle is intentionally excluded from Git because the complete
all-month model data is approximately 113,568,169 bytes compressed and
137,270,856 bytes installed. A controlled publication job must provision the
bundle before packaging the deployment tree. The updater now fails before
activation if the tracked manifest or generated provenance is absent, and the
build fails on any missing file, incomplete month coverage, or hash mismatch.

The upstream `wasm-latest` tag is mutable. The FieldOps manifest therefore
records its release ID and immutable asset IDs, exact byte hashes, and the
reference build revision. Upstream does not publish the source commit that
produced the current mutable release asset, so that limitation is recorded
explicitly in provenance rather than guessed.