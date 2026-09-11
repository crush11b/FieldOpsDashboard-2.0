import fs from 'node:fs';
import express, { type Request, type Response, type Router } from 'express';
import type { AppCatalogRecord } from '../src/appCatalog/domain';
import { toCatalogRecord } from '../src/appCatalog/domain';
import {
  discoverApps,
  NO_INSTALLATION_EVIDENCE,
  parseDiscoveryRequest,
  type AppFileProbe,
  type AppFileProbeResult,
  type InstallationEvidenceProvider,
} from '../src/appCatalog/discovery';
import type { AppLauncherItem } from '../src/types';
import { isLoopbackRequest } from './dashboardConfig';

// Curated, Windows-only candidate installation paths for the supported local
// ToughBook deployment. These are only ever used as bounded probe candidates;
// finding a file at one of these paths is evidence, never an installation
// action, and the path is never written back into configuration.
export const WINDOWS_CANDIDATE_PATHS: Readonly<Record<string, readonly string[]>> = {
  wsjtx: [
    'C:\\WSJT\\wsjtx\\bin\\wsjtx.exe',
    'C:\\Program Files\\WSJT\\wsjtx\\bin\\wsjtx.exe',
    'C:\\Program Files (x86)\\WSJT\\wsjtx\\bin\\wsjtx.exe',
  ],
  fldigi: [
    'C:\\Program Files (x86)\\fldigi-4.2.05\\fldigi.exe',
    'C:\\Program Files\\fldigi\\fldigi.exe',
  ],
  js8call: [
    'C:\\Program Files\\JS8Call\\js8call.exe',
    'C:\\Program Files (x86)\\JS8Call\\js8call.exe',
  ],
  gridtracker: [
    'C:\\Program Files\\GridTracker\\GridTracker.exe',
    'C:\\Program Files (x86)\\GridTracker\\GridTracker.exe',
  ],
  n1mm: [
    'C:\\Program Files (x86)\\N1MM Logger+\\N1MMLogger.net.exe',
  ],
  direwolf: [
    'C:\\Program Files\\direwolf\\direwolf.exe',
  ],
};

/** Verifies an actual file (not merely a constructed path or directory) exists at `candidatePath`. */
export function statAppFileProbe(candidatePath: string): AppFileProbeResult {
  try {
    const stats = fs.statSync(candidatePath);
    return stats.isFile() ? 'file' : 'directory';
  } catch (error) {
    return isNodeError(error) && error.code === 'ENOENT' ? 'missing' : 'error';
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export interface AppDiscoveryRouterOptions {
  readonly apps: readonly AppLauncherItem[];
  readonly candidatePathsById?: Readonly<Record<string, readonly string[]>>;
  readonly probe?: AppFileProbe;
  readonly now?: () => string;
  readonly installationEvidence?: InstallationEvidenceProvider;
}

export function createAppDiscoveryRouter(options: AppDiscoveryRouterOptions): Router {
  const candidatePathsById = options.candidatePathsById ?? WINDOWS_CANDIDATE_PATHS;
  const probe = options.probe ?? statAppFileProbe;
  const now = options.now ?? (() => new Date().toISOString());
  // No independent installation-evidence source (e.g. a package registry) is
  // wired up yet, so production truthfully reports `installed: unknown`.
  const installationEvidence = options.installationEvidence ?? NO_INSTALLATION_EVIDENCE;

  const router = express.Router();
  router.post('/api/apps/discover', (request: Request, response: Response) => {
    if (!isLoopbackRequest(request)) {
      response.status(403).json({ error: 'Application discovery is local-only.' });
      return;
    }

    const requestedIds = parseDiscoveryRequest(request.body);
    if ('status' in requestedIds) {
      response.status(400).json(requestedIds);
      return;
    }

    // The catalog is derived server-side from trusted configuration on every
    // request; the browser can never supply an executable path, argument,
    // working directory, application definition, or OS claim.
    const records: readonly AppCatalogRecord[] = options.apps
      .map(app => toCatalogRecord(app))
      .filter((record): record is AppCatalogRecord => record !== null);

    const result = discoverApps(records, requestedIds, candidatePathsById, probe, now, installationEvidence);
    response.json(result);
  });
  return router;
}
