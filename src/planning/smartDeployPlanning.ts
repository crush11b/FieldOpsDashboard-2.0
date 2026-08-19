import type { OperatingLocation } from '../location/operatingLocation';
import { gridSquareToLatLon, latLonToGridSquare } from '../types';
import { parseCoordinates, type Coordinates } from '../location/coordinates';
import {
  isAntennaType,
  isDeploymentCompatible,
  isDeploymentGeometry,
  isHeightCategory,
  isHeightCategoryValidForDeployment,
  isPropagationMode,
  isValidCoordinates,
  type AntennaProfile,
  type DeploymentProfile,
  type PropagationMode,
} from '../propagation/domain';
import { isPropagationRegionId, type PropagationRegionId } from '../propagation/regionalDestinations';
import { TELEMETRY_STATUSES, type TelemetrySource } from '../telemetry';

export const SMART_DEPLOY_MAX_MISSION_DURATION_MS = 12 * 60 * 60 * 1000;
export const SMART_DEPLOY_MAX_OBJECTIVE_LENGTH = 256;
export const SMART_DEPLOY_MAX_DEPLOYMENT_NOTES_LENGTH = 256;

export type PlanningInputProvenanceKind = 'operator_entered' | 'externally_resolved';

export interface PlanningInputProvenance {
  readonly kind: PlanningInputProvenanceKind;
  readonly source?: TelemetrySource;
  readonly resolvedAtUtc?: string;
}

export interface ActivationTarget {
  readonly program: string;
  readonly reference: string;
  readonly displayName?: string;
  readonly elevationM?: number;
  readonly coordinates: Coordinates;
  readonly gridSquare?: string;
  readonly provenance: PlanningInputProvenance;
}

export interface MissionWindow {
  readonly start: string;
  readonly end: string;
}

export interface RadioContext {
  readonly name: string;
  readonly model?: string;
}

export interface EquipmentContext {
  readonly radio: RadioContext;
  readonly antenna: AntennaProfile;
  readonly modes: readonly PropagationMode[];
  readonly transmitPowerWatts: number;
  readonly deployment?: DeploymentProfile;
  readonly deploymentNotes?: string;
}

export interface SmartDeployPropagationObjective {
  readonly kind: 'regional';
  readonly regionId: PropagationRegionId;
}

export interface SmartDeployPlanningRequest {
  readonly activationTarget: ActivationTarget;
  readonly plannedOperatingLocation: OperatingLocation;
  readonly currentDeviceLocation?: OperatingLocation;
  readonly propagationObjective: SmartDeployPropagationObjective;
  readonly missionWindow: MissionWindow;
  readonly equipment: EquipmentContext;
  readonly objective?: string;
}

/** Transitional projection for schema-v1 execution and brief consumers. */
export interface SmartDeployExecutionRequest extends SmartDeployPlanningRequest {
  readonly operatingLocation: OperatingLocation;
}

export function toSmartDeployExecutionRequest(request: SmartDeployPlanningRequest): SmartDeployExecutionRequest {
  return { ...request, operatingLocation: request.plannedOperatingLocation };
}

export type SmartDeployPlanningIssueCode =
  | 'required'
  | 'invalid_type'
  | 'invalid_value'
  | 'invalid_coordinates'
  | 'invalid_provenance'
  | 'invalid_timestamp'
  | 'duration_exceeded'
  | 'duplicate_value'
  | 'too_long';

export interface SmartDeployPlanningIssue {
  readonly path: string;
  readonly code: SmartDeployPlanningIssueCode;
  readonly message: string;
}

export interface SmartDeployPlanningValidationResult {
  readonly valid: boolean;
  readonly issues: readonly SmartDeployPlanningIssue[];
}

export interface SmartDeployPlanningNormalizationResult extends SmartDeployPlanningValidationResult {
  readonly request: SmartDeployPlanningRequest | null;
}

export function validateSmartDeployPlanningRequest(input: unknown): SmartDeployPlanningValidationResult {
  return validateRequest(input);
}

export function normalizeSmartDeployPlanningRequest(input: unknown): SmartDeployPlanningNormalizationResult {
  const candidate = normalizeCandidate(input);
  const validation = validateRequest(candidate);
  return { ...validation, request: validation.valid ? candidate as SmartDeployPlanningRequest : null };
}

function normalizeCandidate(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const target = input.activationTarget;
  const window = input.missionWindow;
  const equipment = input.equipment;
  return {
    ...input,
    activationTarget: isRecord(target) ? {
      ...target,
      program: trimString(target.program),
      reference: trimString(target.reference),
      displayName: optionalTrimmedString(target.displayName),
      gridSquare: optionalTrimmedString(target.gridSquare),
      provenance: normalizeProvenance(target.provenance),
    } : target,
    missionWindow: isRecord(window) ? {
      ...window,
      start: normalizeUtcTimestamp(window.start),
      end: normalizeUtcTimestamp(window.end),
    } : window,
    equipment: isRecord(equipment) ? {
      ...equipment,
      radio: isRecord(equipment.radio) ? {
        ...equipment.radio,
        name: trimString(equipment.radio.name),
        model: optionalTrimmedString(equipment.radio.model),
      } : equipment.radio,
      modes: Array.isArray(equipment.modes) ? deduplicateModes(equipment.modes.map(mode => trimString(mode))) : equipment.modes,
      deploymentNotes: optionalTrimmedString(equipment.deploymentNotes),
    } : equipment,
    objective: optionalTrimmedString(input.objective),
  };
}

function validateRequest(input: unknown): SmartDeployPlanningValidationResult {
  const issues: SmartDeployPlanningIssue[] = [];
  if (!isRecord(input)) {
    addIssue(issues, '', 'invalid_type', 'Planning request must be an object.');
    return result(issues);
  }

  validateTarget(input.activationTarget, issues);
  validateOperatingLocation(input.plannedOperatingLocation, 'plannedOperatingLocation', issues);
  if (input.currentDeviceLocation !== undefined) validateOperatingLocation(input.currentDeviceLocation, 'currentDeviceLocation', issues);
  validatePropagationObjective(input.propagationObjective, issues);
  validateMissionWindow(input.missionWindow, issues);
  validateEquipment(input.equipment, issues);
  validateOptionalText(input.objective, 'objective', SMART_DEPLOY_MAX_OBJECTIVE_LENGTH, issues);
  return result(issues);
}

function validateTarget(input: unknown, issues: SmartDeployPlanningIssue[]): void {
  if (!isRecord(input)) {
    addIssue(issues, 'activationTarget', 'required', 'Activation target is required.');
    return;
  }
  validateRequiredString(input.program, 'activationTarget.program', issues);
  validateRequiredString(input.reference, 'activationTarget.reference', issues);
  validateOptionalText(input.displayName, 'activationTarget.displayName', SMART_DEPLOY_MAX_OBJECTIVE_LENGTH, issues);
  if (!isValidCoordinates(input.coordinates)) addIssue(issues, 'activationTarget.coordinates', 'invalid_coordinates', 'Activation target coordinates are invalid.');
  if (input.gridSquare !== undefined && (typeof input.gridSquare !== 'string' || !isGridSquare(input.gridSquare))) {
    addIssue(issues, 'activationTarget.gridSquare', 'invalid_value', 'Activation target grid square is invalid.');
  }
  validateProvenance(input.provenance, 'activationTarget.provenance', issues);
}

function validateOperatingLocation(input: unknown, path: string, issues: SmartDeployPlanningIssue[]): void {
  if (!isRecord(input)) {
    addIssue(issues, path, 'required', `${path === 'plannedOperatingLocation' ? 'Planned operating location' : 'Current device location'} is required.`);
    return;
  }
  if (!isValidCoordinates(input.coordinates) || input.provenance === 'unavailable') {
    addIssue(issues, `${path}.coordinates`, 'invalid_coordinates', `A valid, available ${path === 'plannedOperatingLocation' ? 'planned operating' : 'current device'} location is required.`);
  }
  if (typeof input.provenance !== 'string' || !['current', 'manual', 'stale', 'unavailable'].includes(input.provenance)) {
    addIssue(issues, `${path}.provenance`, 'invalid_provenance', 'Operating location provenance is invalid.');
  }
  if (typeof input.status !== 'string' || !(TELEMETRY_STATUSES as readonly string[]).includes(input.status)) {
    addIssue(issues, `${path}.status`, 'invalid_value', 'Operating location status is invalid.');
  }
  if (!isTelemetrySource(input.source)) addIssue(issues, `${path}.source`, 'invalid_provenance', 'Operating location source is invalid.');
}

function validatePropagationObjective(input: unknown, issues: SmartDeployPlanningIssue[]): void {
  if (!isRecord(input)) {
    addIssue(issues, 'propagationObjective', 'required', 'Propagation objective is required.');
    return;
  }
  if (input.kind !== 'regional') addIssue(issues, 'propagationObjective.kind', 'invalid_value', 'Propagation objective kind is invalid.');
  if (!isPropagationRegionId(input.regionId)) addIssue(issues, 'propagationObjective.regionId', 'invalid_value', 'Propagation objective region is invalid.');
}

function validateMissionWindow(input: unknown, issues: SmartDeployPlanningIssue[]): void {
  if (!isRecord(input)) {
    addIssue(issues, 'missionWindow', 'required', 'Mission window is required.');
    return;
  }
  const start = parseUtcTimestamp(input.start);
  const end = parseUtcTimestamp(input.end);
  if (start === null) addIssue(issues, 'missionWindow.start', 'invalid_timestamp', 'Mission start must be an ISO-8601 timestamp with a timezone.');
  if (end === null) addIssue(issues, 'missionWindow.end', 'invalid_timestamp', 'Mission end must be an ISO-8601 timestamp with a timezone.');
  if (start === null || end === null) return;
  const duration = end - start;
  if (duration <= 0) addIssue(issues, 'missionWindow', 'invalid_value', duration === 0 ? 'Mission start and end must differ.' : 'Mission end must be after mission start.');
  else if (duration > SMART_DEPLOY_MAX_MISSION_DURATION_MS) addIssue(issues, 'missionWindow', 'duration_exceeded', 'Mission window cannot exceed 12 hours.');
}

function validateEquipment(input: unknown, issues: SmartDeployPlanningIssue[]): void {
  if (!isRecord(input)) {
    addIssue(issues, 'equipment', 'required', 'Equipment context is required.');
    return;
  }
  if (!isRecord(input.radio)) {
    addIssue(issues, 'equipment.radio', 'required', 'Radio is required.');
  } else {
    validateRequiredString(input.radio.name, 'equipment.radio.name', issues);
    validateOptionalText(input.radio.model, 'equipment.radio.model', SMART_DEPLOY_MAX_OBJECTIVE_LENGTH, issues);
  }
  if (!isRecord(input.antenna) || !isAntennaType(input.antenna.type)) addIssue(issues, 'equipment.antenna', 'invalid_value', 'A valid antenna is required.');
  if (!Array.isArray(input.modes) || input.modes.length === 0) addIssue(issues, 'equipment.modes', 'required', 'At least one operating mode is required.');
  else {
    const seen = new Set<string>();
    input.modes.forEach((mode, index) => {
      if (!isPropagationMode(mode)) addIssue(issues, `equipment.modes[${index}]`, 'invalid_value', 'Operating mode is invalid or blank.');
      else if (seen.has(mode)) addIssue(issues, `equipment.modes[${index}]`, 'duplicate_value', 'Duplicate operating modes are not allowed after normalization.');
      else seen.add(mode);
    });
  }
  if (typeof input.transmitPowerWatts !== 'number' || !Number.isFinite(input.transmitPowerWatts) || input.transmitPowerWatts <= 0) {
    addIssue(issues, 'equipment.transmitPowerWatts', 'invalid_value', 'Transmit power must be a finite positive number.');
  }
  if (input.deployment !== undefined && !isValidDeployment(input.deployment, input.antenna)) addIssue(issues, 'equipment.deployment', 'invalid_value', 'Deployment configuration is invalid or incompatible with the antenna.');
  validateOptionalText(input.deploymentNotes, 'equipment.deploymentNotes', SMART_DEPLOY_MAX_DEPLOYMENT_NOTES_LENGTH, issues);
}

function validateProvenance(input: unknown, path: string, issues: SmartDeployPlanningIssue[]): void {
  if (!isRecord(input) || (input.kind !== 'operator_entered' && input.kind !== 'externally_resolved')) {
    addIssue(issues, path, 'invalid_provenance', 'Target provenance must identify operator-entered or externally resolved data.');
    return;
  }
  if (input.source !== undefined && !isTelemetrySource(input.source)) addIssue(issues, `${path}.source`, 'invalid_provenance', 'Provenance source is invalid.');
  if (input.resolvedAtUtc !== undefined && parseUtcTimestamp(input.resolvedAtUtc) === null) addIssue(issues, `${path}.resolvedAtUtc`, 'invalid_timestamp', 'Resolution timestamp is invalid.');
  if (input.kind === 'externally_resolved' && (!isTelemetrySource(input.source) || parseUtcTimestamp(input.resolvedAtUtc) === null)) {
    addIssue(issues, path, 'invalid_provenance', 'Externally resolved targets require a valid source and resolution timestamp.');
  }
}

function isValidDeployment(input: unknown, antenna: unknown): input is DeploymentProfile {
  if (!isRecord(input) || !isDeploymentGeometry(input.geometry)) return false;
  if (input.heightCategory !== undefined && (!isHeightCategory(input.heightCategory) || !isHeightCategoryValidForDeployment(input.geometry, input.heightCategory))) return false;
  return isRecord(antenna) && isAntennaType(antenna.type) && isDeploymentCompatible(antenna.type, input.geometry);
}

function validateRequiredString(value: unknown, path: string, issues: SmartDeployPlanningIssue[]): void {
  if (typeof value !== 'string' || value.trim() === '') addIssue(issues, path, 'required', 'A non-blank value is required.');
}

function validateOptionalText(value: unknown, path: string, maxLength: number, issues: SmartDeployPlanningIssue[]): void {
  if (value === undefined) return;
  if (typeof value !== 'string') addIssue(issues, path, 'invalid_type', 'Value must be text.');
  else if (value.trim().length > maxLength) addIssue(issues, path, 'too_long', `Value cannot exceed ${maxLength} characters.`);
}

function isTelemetrySource(value: unknown): value is TelemetrySource {
  return isRecord(value) && typeof value.id === 'string' && value.id.trim() !== '' && typeof value.type === 'string' && value.type.trim() !== '';
}

function isGridSquare(value: string): boolean {
  return /^[A-R]{2}[0-9]{2}(?:[A-X]{2})?$/i.test(value.trim());
}

function parseUtcTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeUtcTimestamp(value: unknown): string | undefined {
  const parsed = parseUtcTimestamp(value);
  return parsed === null ? value as string : new Date(parsed).toISOString();
}

function normalizeProvenance(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return { ...value, source: isTelemetrySource(value.source) ? { ...value.source, id: value.source.id.trim(), type: value.source.type.trim(), name: optionalTrimmedString(value.source.name) } : value.source, resolvedAtUtc: value.resolvedAtUtc === undefined ? undefined : normalizeUtcTimestamp(value.resolvedAtUtc) };
}

function deduplicateModes(values: readonly unknown[]): readonly unknown[] {
  const seen = new Set<unknown>();
  return values.filter(value => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return value === undefined ? undefined : value as string;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function result(issues: readonly SmartDeployPlanningIssue[]): SmartDeployPlanningValidationResult {
  return { valid: issues.length === 0, issues };
}

function addIssue(issues: SmartDeployPlanningIssue[], path: string, code: SmartDeployPlanningIssueCode, message: string): void {
  issues.push({ path, code, message });
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type PlannedOperatingLocationSelection = 'provider_reference' | 'current_device' | 'manual';

export interface ManualPlannedOperatingLocationInput {
  readonly gridSquare?: string;
  readonly latitude?: string;
  readonly longitude?: string;
}

export type PlannedOperatingLocationResolution =
  | { readonly status: 'resolved'; readonly location: OperatingLocation }
  | { readonly status: 'unavailable'; readonly reason: string };

export function resolvePlannedOperatingLocation(
  activationTarget: ActivationTarget,
  currentDeviceLocation: OperatingLocation | undefined,
  selection: PlannedOperatingLocationSelection = 'provider_reference',
  manualInput?: ManualPlannedOperatingLocationInput,
): PlannedOperatingLocationResolution {
  if (selection === 'current_device') {
    if (!currentDeviceLocation?.coordinates || currentDeviceLocation.provenance === 'unavailable') {
      return { status: 'unavailable', reason: 'Current device location is unavailable.' };
    }
    return { status: 'resolved', location: { ...currentDeviceLocation, planningSemantics: 'operator_selected_current_device' } };
  }

  if (selection === 'manual') return resolveManualPlannedOperatingLocation(manualInput);

  return {
    status: 'resolved',
    location: {
      coordinates: activationTarget.coordinates,
      gridSquare: activationTarget.gridSquare ?? (latLonToGridSquare(activationTarget.coordinates.lat, activationTarget.coordinates.lon) || null),
      provenance: 'manual',
      status: 'ok',
      source: activationTarget.provenance.source ?? { id: 'activation-provider-reference', type: 'activation_provider_reference' },
      planningSemantics: 'provider_reference_default',
    },
  };
}

function resolveManualPlannedOperatingLocation(input: ManualPlannedOperatingLocationInput | undefined): PlannedOperatingLocationResolution {
  const gridValue = input?.gridSquare?.trim() ?? '';
  const latitudeValue = input?.latitude?.trim() ?? '';
  const longitudeValue = input?.longitude?.trim() ?? '';
  const hasLatitude = latitudeValue !== '';
  const hasLongitude = longitudeValue !== '';
  const hasCoordinates = hasLatitude || hasLongitude;
  const hasGrid = gridValue !== '';

  if (!hasGrid && !hasCoordinates) return { status: 'unavailable', reason: 'Enter a Maidenhead grid or both planned-site coordinates.' };
  if (hasCoordinates && (!hasLatitude || !hasLongitude)) return { status: 'unavailable', reason: 'Enter both planned-site latitude and longitude.' };

  const gridCoordinates = hasGrid && isManualGridSquare(gridValue) ? gridSquareToLatLon(gridValue) : null;
  if (hasGrid && !gridCoordinates) return { status: 'unavailable', reason: 'The planned-site Maidenhead grid is invalid.' };
  const coordinateInput = hasCoordinates ? parseCoordinates(latitudeValue, longitudeValue) : null;
  if (hasCoordinates && !coordinateInput) return { status: 'unavailable', reason: 'The planned-site latitude and longitude are invalid.' };

  const coordinates = coordinateInput ?? gridCoordinates;
  if (!coordinates) return { status: 'unavailable', reason: 'The planned operating location is incomplete.' };
  const calculatedGrid = latLonToGridSquare(coordinates.lat, coordinates.lon);
  if (hasGrid && coordinateInput && !gridMatchesCoordinates(gridValue, calculatedGrid)) {
    return { status: 'unavailable', reason: 'The planned-site grid and coordinates do not identify the same location.' };
  }

  return {
    status: 'resolved',
    location: {
      coordinates,
      gridSquare: hasGrid ? gridValue.toUpperCase() : calculatedGrid || null,
      provenance: 'manual',
      status: 'degraded',
      source: { id: 'smartdeploy:planned-site', type: coordinateInput ? 'manual_planned_site_coordinates' : 'manual_planned_site_grid', name: 'Operator planned site' },
      planningSemantics: 'operator_planned_override',
    },
  };
}

function gridMatchesCoordinates(inputGrid: string, calculatedGrid: string): boolean {
  const normalized = inputGrid.trim().toUpperCase();
  return calculatedGrid.toUpperCase().startsWith(normalized);
}

function isManualGridSquare(value: string): boolean {
  return /^[A-R]{2}[0-9]{2}(?:[A-X]{2})?$/i.test(value);
}