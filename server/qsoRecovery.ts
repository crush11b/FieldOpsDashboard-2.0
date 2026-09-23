import fs from 'node:fs';
import type { Activation } from './activation';
import type { Qso } from './qso';

export interface QsoReassociationRequest {
  readonly sourceActivationId: string;
  readonly targetActivationId: string;
  readonly expectedQsoIds?: readonly string[];
}

export interface QsoReassociationPlan {
  readonly status: 'ready' | 'rejected';
  readonly reason?: string;
  readonly selected: readonly Qso[];
  readonly collisions: readonly Qso[];
  readonly audit: {
    readonly sourceActivationId: string;
    readonly targetActivationId: string;
    readonly selectedQsoIds: readonly string[];
    readonly selectedCount: number;
    readonly collisionCount: number;
  };
}

export function planQsoReassociation(qsos: readonly Qso[], activations: readonly Activation[], request: QsoReassociationRequest): QsoReassociationPlan {
  const target = activations.find(activation => activation.activationId === request.targetActivationId);
  if (!target) return rejected(request, 'The target Activation does not exist.');
  if (request.sourceActivationId === request.targetActivationId) return rejected(request, 'Source and target Activation IDs must differ.');
  const selected = qsos.filter(qso => qso.activationId === request.sourceActivationId);
  if (request.expectedQsoIds && (selected.length !== request.expectedQsoIds.length || selected.some(qso => !request.expectedQsoIds!.includes(qso.qsoId)))) return rejected(request, 'The selected records do not exactly match expectedQsoIds.');
  const collisions = qsos.filter(qso => qso.activationId === request.targetActivationId && selected.some(candidate => sameContact(candidate, qso)));
  if (collisions.length) return rejected(request, 'The target already contains one or more matching contacts.', selected, collisions);
  return { status: 'ready', selected, collisions, audit: audit(request, selected, collisions) };
}

export function applyQsoReassociation(filePath: string, plan: QsoReassociationPlan, now = new Date()): { backupPath: string; auditPath: string } {
  if (plan.status !== 'ready') throw new Error(plan.reason || 'The reassociation plan is not executable.');
  const document = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { storeVersion: number; qsos: Qso[] };
  const selectedIds = new Set(plan.selected.map(qso => qso.qsoId));
  const qsos = document.qsos.map(qso => selectedIds.has(qso.qsoId) ? { ...qso, activationId: plan.audit.targetActivationId, updatedAtUtc: now.toISOString() } : qso);
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.${timestamp}.bak`;
  const auditPath = `${filePath}.${timestamp}.reassociation.json`;
  fs.copyFileSync(filePath, backupPath);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try { fs.writeFileSync(temporaryPath, `${JSON.stringify({ ...document, qsos }, null, 2)}\n`, 'utf8'); fs.renameSync(temporaryPath, filePath); fs.writeFileSync(auditPath, `${JSON.stringify({ ...plan.audit, appliedAtUtc: now.toISOString(), backupPath }, null, 2)}\n`, 'utf8'); } finally { try { fs.rmSync(temporaryPath, { force: true }); } catch {} }
  return { backupPath, auditPath };
}

function rejected(request: QsoReassociationRequest, reason: string, selected: readonly Qso[] = [], collisions: readonly Qso[] = []): QsoReassociationPlan { return { status: 'rejected', reason, selected, collisions, audit: audit(request, selected, collisions) }; }
function audit(request: QsoReassociationRequest, selected: readonly Qso[], collisions: readonly Qso[]) { return { sourceActivationId: request.sourceActivationId, targetActivationId: request.targetActivationId, selectedQsoIds: selected.map(qso => qso.qsoId).sort(), selectedCount: selected.length, collisionCount: collisions.length }; }
function sameContact(left: Qso, right: Qso): boolean { return left.callsign === right.callsign && left.qsoDateTimeUtc === right.qsoDateTimeUtc && left.band === right.band && left.mode === right.mode && left.submode === right.submode; }
