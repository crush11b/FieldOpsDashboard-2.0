import fs from 'node:fs';
import path from 'node:path';

export interface DeploymentIdentity {
  sourceRevision?: string;
  nativeRevision?: string;
  informationalVersion?: string;
  deployedAtUtc?: string;
}

function isCompleteDeploymentIdentity(value: unknown): value is DeploymentIdentity {
  if (!value || typeof value !== 'object') return false;
  const identity = value as DeploymentIdentity;
  return typeof identity.sourceRevision === 'string' && /^[0-9a-f]{40}$/i.test(identity.sourceRevision) &&
    typeof identity.nativeRevision === 'string' && /^[0-9a-f]{40}$/i.test(identity.nativeRevision) &&
    typeof identity.informationalVersion === 'string' && identity.informationalVersion.trim().length > 0;
}

export function getDeploymentManifestPath(bundlePath = __filename): string {
  return path.join(path.dirname(path.dirname(path.resolve(bundlePath))), 'deployment-manifest.json');
}

export function loadDeploymentIdentity(manifestPath?: string, bundlePath = __filename): DeploymentIdentity {
  const resolvedManifestPath = manifestPath === undefined
    ? getDeploymentManifestPath(bundlePath)
    : path.isAbsolute(manifestPath) ? manifestPath : null;
  if (!resolvedManifestPath) return {};
  try {
    const identity = JSON.parse(fs.readFileSync(resolvedManifestPath, 'utf8').replace(/^\uFEFF/, ''));
    return isCompleteDeploymentIdentity(identity) ? identity : {};
  } catch {
    return {};
  }
}