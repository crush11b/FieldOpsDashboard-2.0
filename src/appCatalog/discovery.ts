import { isStableApplicationId, type AppCatalogRecord, type AppCatalogTarget, type CatalogTruth, type LaunchOutcome } from './domain';

// Bounds keep discovery requests, candidate probing, and responses small and
// predictable. They are not tuned for a catalog of unbounded size.
export const APP_DISCOVERY_MAX_REQUESTED_IDS = 50;
export const APP_DISCOVERY_MAX_ID_LENGTH = 128;
export const APP_DISCOVERY_MAX_CANDIDATE_PATHS = 8;
const MAX_REASON_LENGTH = 256;

export type AppFileProbeResult = 'file' | 'directory' | 'missing' | 'error';
export type AppFileProbe = (candidatePath: string) => AppFileProbeResult;
export type DiscoveryClock = () => string;

/** Independent installation evidence (e.g. a package registry). A file probe alone never proves installation. */
export type InstallationEvidenceProvider = (id: string) => CatalogTruth;
export const NO_INSTALLATION_EVIDENCE: InstallationEvidenceProvider = () => 'unknown';

export type AppDiscoveryEvidenceSource =
  | 'configured_path'
  | 'candidate_path'
  | 'configured_web_target'
  | 'unsupported_target'
  | 'disabled_record'
  | 'unknown_id'
  | 'probe_error';

/**
 * A single application's discovery evidence. `launch` is always `unknown`
 * here: discovery never synthesizes a launch outcome. Only a real launch
 * attempt (see server/launcher.ts) may report a launch outcome.
 */
export interface AppDiscoveryObservation {
  readonly id: string;
  readonly configured: CatalogTruth;
  readonly enabled: CatalogTruth;
  readonly detected: CatalogTruth;
  readonly installed: CatalogTruth;
  readonly available: CatalogTruth;
  readonly launch: LaunchOutcome;
  readonly evidenceSource: AppDiscoveryEvidenceSource;
  readonly reason: string;
  readonly observedAtUtc: string;
}

export interface AppDiscoveryResult {
  readonly observations: Readonly<Record<string, AppDiscoveryObservation>>;
}

export interface AppDiscoveryRequestError {
  readonly status: 'invalid_request';
  readonly reason: string;
}

function isPermittedWebTarget(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function isConfiguredTarget(target: AppCatalogTarget): boolean {
  if (target.kind === 'native') return target.executablePath.length > 0;
  if (target.kind === 'web') return isPermittedWebTarget(target.url);
  return false;
}

function boundedReason(reason: string): string {
  return reason.slice(0, MAX_REASON_LENGTH);
}

/**
 * Validates a browser-supplied discovery request. Only catalog IDs are
 * accepted; the caller may never supply a path, argument, or target object.
 */
export function parseRequestedIds(value: unknown): readonly string[] | AppDiscoveryRequestError {
  if (!Array.isArray(value)) {
    return { status: 'invalid_request', reason: 'A bounded array of application IDs is required.' };
  }
  if (value.length === 0) {
    return { status: 'invalid_request', reason: 'At least one application ID is required.' };
  }
  if (value.length > APP_DISCOVERY_MAX_REQUESTED_IDS) {
    return { status: 'invalid_request', reason: 'Too many application IDs were requested.' };
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > APP_DISCOVERY_MAX_ID_LENGTH || !isStableApplicationId(entry)) {
      return { status: 'invalid_request', reason: 'Application IDs must be bounded, non-empty strings.' };
    }
    if (seen.has(entry)) continue;
    seen.add(entry);
    ids.push(entry);
  }
  return ids;
}

/**
 * Validates the full browser-supplied request body. Only a plain object
 * containing exactly the `ids` field is accepted; any other field (an
 * application object, path, argument, working directory, or OS claim) is
 * rejected rather than silently ignored.
 */
export function parseDiscoveryRequest(body: unknown): readonly string[] | AppDiscoveryRequestError {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { status: 'invalid_request', reason: 'The request body must be a plain object containing only an ids field.' };
  }
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== 'ids') {
    return { status: 'invalid_request', reason: 'The request body must contain only the ids field.' };
  }
  return parseRequestedIds((body as Record<string, unknown>).ids);
}

function probeNativeTarget(
  target: Extract<AppCatalogTarget, { kind: 'native' }>,
  candidatePaths: readonly string[],
  probe: AppFileProbe,
): { detected: CatalogTruth; available: CatalogTruth; evidenceSource: AppDiscoveryEvidenceSource; reason: string } {
  const configuredPath = target.executablePath;
  const boundedCandidates = candidatePaths.slice(0, APP_DISCOVERY_MAX_CANDIDATE_PATHS);
  const attempts: Array<{ path: string; source: AppDiscoveryEvidenceSource }> = [
    ...(configuredPath ? [{ path: configuredPath, source: 'configured_path' as const }] : []),
    ...boundedCandidates.map(path => ({ path, source: 'candidate_path' as const })),
  ];

  if (attempts.length === 0) {
    return {
      detected: 'no', available: 'no',
      evidenceSource: 'configured_path',
      reason: 'No executable path is configured.',
    };
  }

  let sawError = false;
  let directoryAttempt: { path: string; source: AppDiscoveryEvidenceSource } | undefined;
  for (const attempt of attempts) {
    const result = probe(attempt.path);
    if (result === 'file') {
      return {
        detected: 'yes', available: attempt.source === 'configured_path' ? 'yes' : 'no',
        evidenceSource: attempt.source,
        reason: attempt.source === 'configured_path'
          ? 'A configured executable file was found.'
          : 'A server-owned candidate executable file was found, but it is not available to the current launcher until the configured path is updated.',
      };
    }
    if (result === 'error') sawError = true;
    else if (result === 'directory' && !directoryAttempt) directoryAttempt = attempt;
  }

  if (sawError) {
    return {
      detected: 'unknown', available: 'unknown',
      evidenceSource: 'probe_error',
      reason: 'The executable path could not be verified due to a local access error.',
    };
  }
  if (directoryAttempt) {
    return {
      detected: 'no', available: 'no',
      evidenceSource: directoryAttempt.source,
      reason: 'The configured path is a directory, not an executable file.',
    };
  }
  return {
    detected: 'no', available: 'no',
    // A miss on bounded candidate paths is not proof of absence anywhere else on disk.
    evidenceSource: configuredPath ? 'configured_path' : 'candidate_path',
    reason: 'No configured or candidate executable file was found at the bounded probe locations.',
  };
}

/**
 * Produces bounded, truthful discovery evidence for a set of requested
 * catalog IDs against trusted, server-owned catalog records. This function
 * never touches the filesystem itself; `probe` and `installationEvidence`
 * are injected so tests do not depend on applications actually installed on
 * the development machine, and so a file probe alone can never prove
 * installation.
 */
export function discoverApps(
  records: readonly AppCatalogRecord[],
  requestedIds: readonly string[],
  candidatePathsById: Readonly<Record<string, readonly string[]>>,
  probe: AppFileProbe,
  now: DiscoveryClock,
  installationEvidence: InstallationEvidenceProvider = NO_INSTALLATION_EVIDENCE,
): AppDiscoveryResult {
  const recordsById = new Map(records.map(record => [record.id, record]));
  const observedAtUtc = now();
  const observations: Record<string, AppDiscoveryObservation> = {};

  for (const id of requestedIds) {
    const record = recordsById.get(id);
    if (!record) {
      observations[id] = {
        id, configured: 'no', enabled: 'unknown', detected: 'unknown', installed: 'unknown', available: 'unknown', launch: 'unknown',
        evidenceSource: 'unknown_id', reason: boundedReason('The application ID is not recognized by the catalog.'), observedAtUtc,
      };
      continue;
    }

    const configured: CatalogTruth = isConfiguredTarget(record.target) ? 'yes' : 'no';

    if (!record.enabled) {
      observations[id] = {
        id, configured, enabled: 'no', detected: 'unknown', installed: 'unknown', available: 'no', launch: 'unknown',
        evidenceSource: 'disabled_record', reason: boundedReason('The application is disabled and was not probed.'), observedAtUtc,
      };
      continue;
    }

    const target = record.target;
    if (target.kind === 'unsupported') {
      observations[id] = {
        id, configured, enabled: 'yes', detected: 'unsupported', installed: 'unsupported', available: 'unsupported', launch: 'unknown',
        evidenceSource: 'unsupported_target',
        reason: boundedReason(target.reason === 'missing' ? 'No target is configured for this application.' : 'This legacy target type is not supported for discovery.'),
        observedAtUtc,
      };
      continue;
    }

    if (target.kind === 'web') {
      const permitted = isPermittedWebTarget(target.url);
      observations[id] = {
        id, configured, enabled: 'yes', detected: 'unsupported', installed: 'unsupported',
        // No network reachability check is performed, so a structurally valid web
        // target is still only ever `unknown` availability, never a claimed `yes`.
        available: permitted ? 'unknown' : 'no',
        launch: 'unknown',
        evidenceSource: 'configured_web_target',
        reason: boundedReason(permitted
          ? 'A valid HTTP or HTTPS web target is configured. Web targets are never locally installed, and reachability is not checked.'
          : 'The configured web target is not a valid HTTP or HTTPS URI.'),
        observedAtUtc,
      };
      continue;
    }

    const candidatePaths = candidatePathsById[id] ?? [];
    const probed = probeNativeTarget(target, candidatePaths, probe);
    observations[id] = {
      id, configured, enabled: 'yes', launch: 'unknown', observedAtUtc,
      detected: probed.detected,
      available: probed.available,
      // Installation is never inferred from the file probe; only independent
      // installation evidence (when supplied) may report yes/no.
      installed: installationEvidence(id),
      evidenceSource: probed.evidenceSource,
      reason: boundedReason(probed.reason),
    };
  }

  return { observations };
}
