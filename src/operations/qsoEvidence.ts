import type { Qso } from '../../server/qso';

export interface QsoEvidence {
  readonly total: number;
  readonly byBand: Readonly<Record<string, number>>;
  readonly byMode: Readonly<Record<string, number>>;
  readonly byBandMode: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly mostRecentQsoUtc: string | null;
  readonly mostRecentQsoUtcByBand: Readonly<Record<string, string>>;
  readonly currentBand: string | null;
  readonly currentBandQsoCount: number;
  readonly currentBandMostRecentQsoUtc: string | null;
  readonly currentBandMode: string | null;
  readonly currentBandModeQsoCount: number;
  readonly hasTwoWayQsoByBand: Readonly<Record<string, boolean>>;
}

export function aggregateQsoEvidence(qsos: readonly Qso[], currentBand?: string, currentMode?: string): QsoEvidence {
  const band = currentBand || null;
  const mode = currentMode?.toUpperCase() || null;
  const byBand: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  const byBandMode: Record<string, Record<string, number>> = {};
  const mostRecentQsoUtcByBand: Record<string, string> = {};
  const hasTwoWayQsoByBand: Record<string, boolean> = {};
  const ordered = [...qsos].sort((left, right) => right.qsoDateTimeUtc.localeCompare(left.qsoDateTimeUtc) || right.qsoId.localeCompare(left.qsoId));

  for (const qso of ordered) {
    byBand[qso.band] = (byBand[qso.band] ?? 0) + 1;
    byMode[qso.mode] = (byMode[qso.mode] ?? 0) + 1;
    byBandMode[qso.band] ??= {};
    byBandMode[qso.band][qso.mode] = (byBandMode[qso.band][qso.mode] ?? 0) + 1;
    hasTwoWayQsoByBand[qso.band] = true;
    if (!mostRecentQsoUtcByBand[qso.band]) mostRecentQsoUtcByBand[qso.band] = qso.qsoDateTimeUtc;
  }

  const currentBandQsos = band ? ordered.filter(qso => qso.band === band) : [];
  const currentBandModeQsos = band && mode ? currentBandQsos.filter(qso => qso.mode === mode) : [];
  return {
    total: qsos.length,
    byBand,
    byMode,
    byBandMode,
    mostRecentQsoUtc: ordered[0]?.qsoDateTimeUtc ?? null,
    mostRecentQsoUtcByBand,
    currentBand: band,
    currentBandQsoCount: currentBandQsos.length,
    currentBandMostRecentQsoUtc: currentBandQsos[0]?.qsoDateTimeUtc ?? null,
    currentBandMode: mode,
    currentBandModeQsoCount: currentBandModeQsos.length,
    hasTwoWayQsoByBand,
  };
}

export function withCurrentQsoContext(evidence: QsoEvidence, currentBand?: string, currentMode?: string): QsoEvidence {
  const band = currentBand || null;
  const mode = currentMode?.toUpperCase() || null;
  const bandQsos = band ? evidence.byBand[band] ?? 0 : 0;
  const modeQsos = band && mode ? evidence.byBandMode[band]?.[mode] ?? 0 : 0;
  return {
    ...evidence,
    currentBand: band,
    currentBandQsoCount: bandQsos,
    currentBandMostRecentQsoUtc: band ? evidence.mostRecentQsoUtcByBand[band] ?? null : null,
    currentBandMode: mode,
    currentBandModeQsoCount: modeQsos,
  };
}
