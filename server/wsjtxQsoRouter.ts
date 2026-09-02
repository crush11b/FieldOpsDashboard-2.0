import { normalizeQso, type Qso } from './qso';
import type { ActivationStore } from './activationStore';
import type { WsjtxLoggedQsoCandidate } from './wsjtx';
import type { QsoStore } from './qsoStore';

export type WsjtxQsoRouteResult =
  | { readonly status: 'persisted'; readonly qso: Qso }
  | { readonly status: 'duplicate'; readonly qso: Qso }
  | { readonly status: 'no_active'; readonly reason: 'zero_active' | 'multiple_active' }
  | { readonly status: 'unavailable'; readonly reason: 'normalization_failed' | 'activation_read_failed' | 'qso_read_failed' | 'persistence_failed' };

export interface WsjtxQsoRouterOptions {
  readonly activationStore: Pick<ActivationStore, 'list'>;
  readonly qsoStore: Pick<QsoStore, 'listByActivation' | 'create'>;
}

export class WsjtxQsoRouter {
  private readonly recent = new Map<string, { readonly qso: Qso; readonly timestamp: number }>();

  constructor(private readonly options: WsjtxQsoRouterOptions) {}

  route(candidate: WsjtxLoggedQsoCandidate): WsjtxQsoRouteResult {
    const activations = this.options.activationStore.list();
    if (activations.diagnostics.some(item => item.code === 'io_error')) return { status: 'unavailable', reason: 'activation_read_failed' };
    const active = activations.activations.filter(activation => activation.status === 'active');
    if (active.length !== 1) return { status: 'no_active', reason: active.length === 0 ? 'zero_active' : 'multiple_active' };

    const activationId = active[0].activationId;
    const existing = this.options.qsoStore.listByActivation(activationId);
    if (existing.diagnostics.some(item => item.code === 'io_error')) return { status: 'unavailable', reason: 'qso_read_failed' };
    const input = {
      activationId,
      qsoDateTimeUtc: candidate.qsoDateTimeUtc,
      callsign: candidate.callsign,
      band: candidate.band ?? undefined,
      frequencyMHz: candidate.frequencyMHz,
      mode: candidate.mode,
      submode: candidate.submode,
      rstSent: candidate.rstSent,
      rstReceived: candidate.rstReceived,
      gridSquare: candidate.gridSquare,
      operatorCallsign: candidate.operatorCallsign,
      stationCallsign: candidate.stationCallsign,
      myGridSquare: candidate.myGridSquare,
      source: 'wsjtx' as const,
    };
    const identity = dedupeIdentity(input);
    const timestamp = Date.parse(candidate.qsoDateTimeUtc);
    for (const [key, entry] of this.recent) if (timestamp - entry.timestamp > 600_000) this.recent.delete(key);
    const recentDuplicate = this.recent.get(identity);
    if (recentDuplicate && Math.abs(timestamp - recentDuplicate.timestamp) <= 2_000) return { status: 'duplicate', qso: recentDuplicate.qso };
    const duplicate = existing.qsos.find(qso => dedupeIdentity(qso) === identity && Math.abs(timestamp - Date.parse(qso.qsoDateTimeUtc)) <= 2_000);
    if (duplicate) return { status: 'duplicate', qso: duplicate };
    const normalized = normalizeQso({ ...input, qsoId: 'diagnostic', schemaVersion: 1, createdAtUtc: candidate.qsoDateTimeUtc, updatedAtUtc: candidate.qsoDateTimeUtc });
    if (!normalized.valid || !normalized.qso) return { status: 'unavailable', reason: 'normalization_failed' };
    try {
      const qso = this.options.qsoStore.create(input).qso;
      this.recent.set(identity, { qso, timestamp });
      while (this.recent.size > 256) this.recent.delete(this.recent.keys().next().value!);
      return { status: 'persisted', qso };
    } catch {
      return { status: 'unavailable', reason: 'persistence_failed' };
    }
  }
}

function dedupeIdentity(value: Pick<Qso, 'activationId' | 'callsign' | 'band' | 'frequencyMHz' | 'mode'>): string {
  return [value.activationId, value.callsign.trim().toUpperCase(), value.mode.trim().toUpperCase(), value.band.trim().toLowerCase(), value.frequencyMHz === undefined ? '' : value.frequencyMHz.toFixed(6)].join('|');
}