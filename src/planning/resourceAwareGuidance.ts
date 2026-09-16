import type { SmartDeployBriefV2 } from '../../server/smartDeployBrief';
import type { EquipmentFact, LoadoutSnapshot } from '../equipment/domain';

export type PlanningFindingStatus = 'supported' | 'attention' | 'unknown';
export type PlanningFindingCategory = 'loadout' | 'power' | 'weather' | 'deployment' | 'contingency';
export interface PlanningFinding { readonly id: string; readonly category: PlanningFindingCategory; readonly status: PlanningFindingStatus; readonly conclusion: string; readonly basis: string; readonly sourceState: 'operator_fact' | 'operator_limitation' | 'retained_evidence' | 'unknown' | 'deterministic_rule'; readonly limitation: string; readonly reconsiderWhen: string; }
export interface ResourceAwareGuidance { readonly kind: 'resource_aware_mission_guidance'; readonly findings: readonly PlanningFinding[]; readonly limitations: readonly string[]; }

export function buildResourceAwareGuidance(brief: SmartDeployBriefV2, forecast: any | null): ResourceAwareGuidance {
  const snapshot = brief.loadoutSnapshot;
  return { kind: 'resource_aware_mission_guidance', findings: [loadoutFinding(snapshot), powerFinding(snapshot, brief), weatherFinding(forecast), deploymentFinding(brief, snapshot), contingencyFinding(snapshot, forecast)], limitations: ['Deterministic guidance from retained operator facts and named evidence; it is not a guarantee, safety approval, or command.', 'Missing facts remain unknown. Manufacturer/model names are never used to invent capabilities or endurance.', 'The operator remains responsible for access, weather, electrical, RF exposure, and regulatory decisions.'] };
}

function loadoutFinding(snapshot?: LoadoutSnapshot): PlanningFinding {
  if (!snapshot) return finding('loadout-coverage', 'loadout', 'unknown', 'No retained loadout is available for mission suitability review.', 'No loadout snapshot was associated with this plan.', 'unknown', 'The planned station may still be available outside a retained loadout.', 'Re-evaluate after selecting and regenerating with a reusable loadout.');
  const kinds = new Set(snapshot.items.map(entry => entry.equipment.kind));
  const absent = ([['radio', 'radio'], ['antenna', 'antenna'], ['battery', 'battery or power system']] as const).filter(([kind]) => kind === 'battery' ? !kinds.has('battery') && !kinds.has('power_system') : !kinds.has(kind)).map(([, label]) => label);
  return absent.length ? finding('loadout-coverage', 'loadout', 'attention', `The retained loadout does not document: ${absent.join(', ')}.`, `${snapshot.items.length} snapshotted equipment record(s) were checked by equipment kind.`, 'deterministic_rule', 'Absence from the snapshot does not prove the equipment will be absent in the field.', 'Re-evaluate after the loadout snapshot includes the missing resource or the operator confirms a separate provision.') : finding('loadout-coverage', 'loadout', 'supported', 'The retained loadout documents a radio, antenna, and station power resource.', `${snapshot.items.length} operator-managed equipment record(s) are frozen in the plan.`, 'operator_fact', 'A packing record does not prove items are present, charged, connected, functional, or suitable.', 'Reconsider if the packed equipment differs from the retained snapshot.');
}

function powerFinding(snapshot: LoadoutSnapshot | undefined, brief: SmartDeployBriefV2): PlanningFinding {
  const durationHours = (Date.parse(brief.missionWindow.end) - Date.parse(brief.missionWindow.start)) / 3_600_000;
  if (!snapshot) return unknownPower(durationHours, 'No loadout snapshot is available.');
  const capacityWh = sumFact(snapshot, 'usable_capacity_wh', ['battery', 'power_system']);
  const drawW = sumFact(snapshot, 'expected_average_draw_w');
  if (capacityWh === null || drawW === null || drawW <= 0) return unknownPower(durationHours, 'A numeric usable_capacity_wh and expected_average_draw_w are both required in the retained equipment facts.');
  const enduranceHours = capacityWh / drawW;
  return finding('station-endurance', 'power', enduranceHours >= durationHours ? 'supported' : 'attention', `Operator facts estimate ${round(enduranceHours)} hours of station endurance for a ${round(durationHours)}-hour mission.`, `${round(capacityWh)} Wh usable capacity / ${round(drawW)} W expected average draw.`, 'deterministic_rule', 'This arithmetic excludes unrecorded loads, temperature effects, aging, conversion loss unless already reflected in usable capacity, and reserve policy.', 'Recalculate when usable capacity, expected draw, mission duration, or packed quantities change.');
}
function unknownPower(durationHours: number, basis: string): PlanningFinding { return finding('station-endurance', 'power', 'unknown', `Station endurance is unknown for the ${round(durationHours)}-hour mission.`, basis, 'unknown', 'FieldOps will not derive endurance from battery labels, voltage, amp-hours, radio model, or intended transmit power.', 'Add explicit usable_capacity_wh and expected_average_draw_w operator facts, then regenerate the plan.'); }

function weatherFinding(forecast: any | null): PlanningFinding {
  if (!forecast) return finding('weather-concerns', 'weather', 'unknown', 'Weather deployment concerns are unknown.', 'No retained mission forecast is available.', 'unknown', 'No safe-weather conclusion can be drawn from missing evidence.', 'Re-evaluate after a mission forecast is retained or conditions are checked independently.');
  const periods = [...(forecast.hourly ?? forecast.periods ?? []), ...(forecast.operatingPeriods ?? [])];
  const precipitation = maxNumber(periods, ['precipitationProbability', 'precipitationProbabilityMax']); const gust = maxNumber(periods, ['windGustMph', 'windGustMaxMph']); const low = minNumber(periods, ['temperatureF', 'temperatureMinF']); const high = maxNumber(periods, ['temperatureF', 'temperatureMaxF']);
  const concerns = [precipitation !== null && precipitation >= 50 ? `${round(precipitation)}% precipitation probability` : null, gust !== null && gust >= 25 ? `${round(gust)} mph gusts` : null, low !== null && low <= 32 ? `${round(low)}°F low` : null, high !== null && high >= 95 ? `${round(high)}°F high` : null].filter(Boolean);
  return finding('weather-concerns', 'weather', concerns.length ? 'attention' : 'supported', concerns.length ? `Retained forecast crosses planning thresholds: ${concerns.join(', ')}.` : 'Retained forecast does not cross the bounded precipitation, wind-gust, or temperature planning thresholds.', `Thresholds: precipitation ≥50%, gust ≥25 mph, temperature ≤32°F or ≥95°F. Forecast freshness: ${forecast.freshness ?? 'retained'}.`, 'retained_evidence', 'These thresholds are planning prompts, not hazard declarations; alerts, lightning, site exposure, and rapid changes require separate operator review.', 'Reconsider whenever the retained forecast changes, becomes stale, or field conditions differ.');
}

function deploymentFinding(brief: SmartDeployBriefV2, snapshot?: LoadoutSnapshot): PlanningFinding {
  const limitations = [...(snapshot?.limitations ?? []), ...(snapshot?.items.flatMap(entry => entry.equipment.kind === 'antenna' ? entry.equipment.limitations : []) ?? [])];
  if (!brief.station.deployment) return finding('antenna-deployment', 'deployment', 'unknown', 'Antenna deployment geometry and height are not documented.', limitations.length ? limitations.join(' ') : 'No deployment configuration is retained.', limitations.length ? 'operator_limitation' : 'unknown', 'Antenna type alone does not establish space, supports, height, tuning, weather tolerance, or suitability.', 'Re-evaluate after deployment geometry/height and site constraints are confirmed.');
  return finding('antenna-deployment', 'deployment', limitations.length ? 'attention' : 'supported', limitations.length ? `Deployment is planned, with ${limitations.length} operator-recorded limitation(s) requiring confirmation.` : `Deployment is planned as ${brief.station.deployment.geometry} at ${brief.station.deployment.heightCategory}.`, limitations.length ? limitations.join(' ') : 'The retained station deployment supplies geometry and height category.', limitations.length ? 'operator_limitation' : 'operator_fact', 'The model uses reference-antenna assumptions and does not prove the selected antenna can be installed or will achieve modeled performance.', 'Reconsider after a site inspection, weather change, or any equipment/deployment change.');
}

function contingencyFinding(snapshot: LoadoutSnapshot | undefined, forecast: any | null): PlanningFinding {
  const notes = [...(snapshot?.limitations ?? []), ...(snapshot?.items.flatMap(entry => entry.equipment.limitations) ?? [])];
  return notes.length ? finding('operator-contingencies', 'contingency', 'attention', 'Operator-recorded limitations require a deliberate contingency check before departure.', notes.join(' '), 'operator_limitation', 'FieldOps does not invent substitute equipment or a safe fallback.', 'Clear each limitation or record an operator-selected contingency before departure.') : finding('operator-contingencies', 'contingency', 'unknown', 'No operator-recorded contingency is available.', forecast ? 'Forecast evidence is retained, but no equipment/loadout limitation defines a fallback.' : 'Neither retained forecast evidence nor an operator-recorded fallback establishes a contingency.', 'unknown', 'Silence in the record is not proof that no contingency is needed.', 'Record relevant loadout limitations and an operator-selected fallback where needed.');
}

function sumFact(snapshot: LoadoutSnapshot, key: string, kinds?: readonly string[]): number | null { let total = 0; let found = false; for (const entry of snapshot.items) { if (kinds && !kinds.includes(entry.equipment.kind)) continue; const value = numericFact(entry.equipment.facts, key); if (value !== null) { found = true; total += value * entry.item.quantity; } } return found ? total : null; }
function numericFact(facts: readonly EquipmentFact[], key: string): number | null { const fact = facts.find(item => item.key === key); return fact && typeof fact.value === 'number' && Number.isFinite(fact.value) ? fact.value : null; }
function maxNumber(values: readonly any[], keys: readonly string[]): number | null { return extreme(values, keys, Math.max); } function minNumber(values: readonly any[], keys: readonly string[]): number | null { return extreme(values, keys, Math.min); }
function extreme(values: readonly any[], keys: readonly string[], operation: (...items: number[]) => number): number | null { const numbers = values.flatMap(value => keys.map(key => value?.[key])).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)); return numbers.length ? operation(...numbers) : null; }
function round(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function finding(id: string, category: PlanningFindingCategory, status: PlanningFindingStatus, conclusion: string, basis: string, sourceState: PlanningFinding['sourceState'], limitation: string, reconsiderWhen: string): PlanningFinding { return { id, category, status, conclusion, basis, sourceState, limitation, reconsiderWhen }; }
