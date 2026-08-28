import { qsoFingerprint, type Qso } from './qso';
import type { ActivationStore } from './activationStore';
import type { WsjtxLoggedQsoCandidate } from './wsjtx';
import type { QsoStore } from './qsoStore';

export type WsjtxQsoRouteResult =
  | { readonly status: 'persisted'; readonly qso: Qso }
  | { readonly status: 'duplicate'; readonly qso: Qso }
  | { readonly status: 'no_active' }
  | { readonly status: 'unavailable'; readonly reason: 'activation_read_failed' | 'qso_read_failed' | 'persistence_failed' };

export interface WsjtxQsoRouterOptions {
  readonly activationStore: Pick<ActivationStore, 'list'>;
  readonly qsoStore: Pick<QsoStore, 'listByActivation' | 'create'>;
}

export class WsjtxQsoRouter {
  constructor(private readonly options: WsjtxQsoRouterOptions) {}

  route(candidate: WsjtxLoggedQsoCandidate): WsjtxQsoRouteResult {
    const activations = this.options.activationStore.list();
    if (activations.diagnostics.some(item => item.code === 'io_error')) return { status: 'unavailable', reason: 'activation_read_failed' };
    const active = activations.activations.filter(activation => activation.status === 'active');
    if (active.length !== 1) return { status: 'no_active' };

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
      rstSent: candidate.rstSent,
      rstReceived: candidate.rstReceived,
      gridSquare: candidate.gridSquare,
      operatorCallsign: candidate.operatorCallsign,
      stationCallsign: candidate.stationCallsign,
      myGridSquare: candidate.myGridSquare,
      source: 'wsjtx' as const,
    };
    const fingerprint = qsoFingerprint({ ...input, submode: undefined } as Qso);
    const duplicate = existing.qsos.find(qso => qsoFingerprint(qso) === fingerprint);
    if (duplicate) return { status: 'duplicate', qso: duplicate };
    try {
      return { status: 'persisted', qso: this.options.qsoStore.create(input).qso };
    } catch {
      return { status: 'unavailable', reason: 'persistence_failed' };
    }
  }
}