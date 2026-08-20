import { randomUUID } from 'node:crypto';

export const FIELD_READINESS_CHECKLIST_SCHEMA_VERSION = 1 as const;
export const FIELD_READINESS_CHECKLIST_TEMPLATE_ID = 'smartdeploy-field-readiness' as const;
export const FIELD_READINESS_CHECKLIST_TEMPLATE_VERSION = 1 as const;
export const FIELD_READINESS_CHECKLIST_MAX_RETAINED = 10;
export const FIELD_READINESS_CHECKLIST_MAX_ID_LENGTH = 128;
export const FIELD_READINESS_CHECKLIST_MAX_SECTION_TITLE_LENGTH = 64;
export const FIELD_READINESS_CHECKLIST_MAX_ITEM_TEXT_LENGTH = 256;
export const FIELD_READINESS_CHECKLIST_SECTION_COUNT = 2;
export const FIELD_READINESS_CHECKLIST_ITEM_COUNT = 14;

export type FieldReadinessChecklistSectionId = 'field_setup' | 'operating_readiness';
export type FieldReadinessChecklistItemId = 'site_access' | 'work_area' | 'antenna_clearance' | 'feedline_route' | 'common_mode' | 'station_connections' | 'power_ready' | 'clock_sync' | 'antenna_path' | 'frequency_mode' | 'swr_output' | 'logging_reference' | 'brief_review' | 'final_station_check';

export interface FieldReadinessChecklistItem { readonly itemId: FieldReadinessChecklistItemId; readonly text: string; readonly completed: boolean; }
export interface FieldReadinessChecklistSection { readonly sectionId: FieldReadinessChecklistSectionId; readonly title: string; readonly items: readonly FieldReadinessChecklistItem[]; }
export interface FieldReadinessChecklist { readonly schemaVersion: typeof FIELD_READINESS_CHECKLIST_SCHEMA_VERSION; readonly templateId: typeof FIELD_READINESS_CHECKLIST_TEMPLATE_ID; readonly templateVersion: typeof FIELD_READINESS_CHECKLIST_TEMPLATE_VERSION; readonly checklistId: string; readonly briefId: string; readonly createdAtUtc: string; readonly updatedAtUtc: string; readonly sections: readonly FieldReadinessChecklistSection[]; }
export interface CreateFieldReadinessChecklistInput { readonly briefId: string; }
export interface FieldReadinessChecklistNormalizationResult { readonly valid: boolean; readonly checklist: FieldReadinessChecklist | null; readonly issues: readonly string[]; }

const TEMPLATE_SECTIONS: readonly FieldReadinessChecklistSection[] = [
  { sectionId: 'field_setup', title: 'FIELD SETUP', items: [
    { itemId: 'site_access', text: 'Confirm the operating site and access conditions are suitable.', completed: false },
    { itemId: 'work_area', text: 'Check footing, visibility, overhead hazards, and the working area.', completed: false },
    { itemId: 'antenna_clearance', text: 'Place the antenna and supports clear of people, vehicles, structures, and overhead hazards.', completed: false },
    { itemId: 'feedline_route', text: 'Route and secure the feedline against trip hazards, sharp edges, crushing, and strain.', completed: false },
    { itemId: 'common_mode', text: 'Install the planned choke or common-mode suppression.', completed: false },
    { itemId: 'station_connections', text: 'Connect the radio, interface, accessories, and feedline.', completed: false },
    { itemId: 'power_ready', text: 'Verify the power source, fuse protection, connectors, and polarity.', completed: false },
  ] },
  { sectionId: 'operating_readiness', title: 'OPERATING READINESS', items: [
    { itemId: 'clock_sync', text: 'Synchronize the station clock if using a time-sensitive digital mode.', completed: false },
    { itemId: 'antenna_path', text: 'Confirm the intended antenna and feedline path is selected.', completed: false },
    { itemId: 'frequency_mode', text: 'Verify the intended frequency and mode.', completed: false },
    { itemId: 'swr_output', text: 'Verify acceptable SWR and the planned transmit output.', completed: false },
    { itemId: 'logging_reference', text: 'Confirm the logging method and activation reference are ready.', completed: false },
    { itemId: 'brief_review', text: 'Review the SmartDeploy plan, limitations, and unavailable or stale information.', completed: false },
    { itemId: 'final_station_check', text: 'Check receive audio, controls, keying, transmit indication, and essential connections.', completed: false },
  ] },
];

export function getFieldReadinessChecklistTemplate(): readonly FieldReadinessChecklistSection[] { return cloneSections(TEMPLATE_SECTIONS); }

export function createFieldReadinessChecklist(input: CreateFieldReadinessChecklistInput, options: { readonly now?: () => Date; readonly createId?: () => string } = {}): FieldReadinessChecklist {
  const timestamp = utcNow(options.now);
  const checklist: FieldReadinessChecklist = { schemaVersion: 1, templateId: FIELD_READINESS_CHECKLIST_TEMPLATE_ID, templateVersion: 1, checklistId: options.createId?.() ?? randomUUID(), briefId: input.briefId, createdAtUtc: timestamp, updatedAtUtc: timestamp, sections: getFieldReadinessChecklistTemplate() };
  const normalized = normalizeFieldReadinessChecklist(checklist);
  if (!normalized.valid || !normalized.checklist) throw validationError(normalized.issues);
  return normalized.checklist;
}

export function updateFieldReadinessChecklistItem(checklist: FieldReadinessChecklist, itemId: string, completed: boolean, options: { readonly now?: () => Date } = {}): FieldReadinessChecklist {
  const normalized = normalizeFieldReadinessChecklist(checklist);
  if (!normalized.valid || !normalized.checklist) throw validationError(normalized.issues);
  if (!isExpectedItemId(itemId) || !normalized.checklist.sections.some(section => section.items.some(item => item.itemId === itemId))) throw new Error(`Unknown checklist item ID: ${itemId}`);
  if (typeof completed !== 'boolean') throw new Error('Checklist completion must be a boolean.');
  return { ...normalized.checklist, updatedAtUtc: utcNow(options.now), sections: normalized.checklist.sections.map(section => ({ ...section, items: section.items.map(item => item.itemId === itemId ? { ...item, completed } : item) })) };
}

export function resetFieldReadinessChecklist(checklist: FieldReadinessChecklist, options: { readonly now?: () => Date } = {}): FieldReadinessChecklist {
  const normalized = normalizeFieldReadinessChecklist(checklist);
  if (!normalized.valid || !normalized.checklist) throw validationError(normalized.issues);
  return { ...normalized.checklist, updatedAtUtc: utcNow(options.now), sections: normalized.checklist.sections.map(section => ({ ...section, items: section.items.map(item => ({ ...item, completed: false })) })) };
}

export function validateFieldReadinessChecklist(input: unknown): input is FieldReadinessChecklist { return normalizeFieldReadinessChecklist(input).valid; }

export function normalizeFieldReadinessChecklist(input: unknown): FieldReadinessChecklistNormalizationResult {
  const issues: string[] = [];
  if (!isRecord(input)) return invalid(['checklist must be an object.']);
  requireExactKeys(input, ['schemaVersion', 'templateId', 'templateVersion', 'checklistId', 'briefId', 'createdAtUtc', 'updatedAtUtc', 'sections'], issues);
  if (input.schemaVersion !== 1) issues.push('schemaVersion is unsupported.');
  if (input.templateId !== FIELD_READINESS_CHECKLIST_TEMPLATE_ID) issues.push('templateId is unsupported.');
  if (input.templateVersion !== 1) issues.push('templateVersion is unsupported.');
  const checklistId = normalizeId(input.checklistId, 'checklistId', issues);
  const briefId = normalizeId(input.briefId, 'briefId', issues);
  const createdAtUtc = normalizeUtcTimestamp(input.createdAtUtc, 'createdAtUtc', issues);
  const updatedAtUtc = normalizeUtcTimestamp(input.updatedAtUtc, 'updatedAtUtc', issues);
  if (createdAtUtc && updatedAtUtc && Date.parse(updatedAtUtc) < Date.parse(createdAtUtc)) issues.push('updatedAtUtc cannot precede createdAtUtc.');
  const sections = normalizeSections(input.sections, issues);
  if (issues.length || !checklistId || !briefId || !createdAtUtc || !updatedAtUtc || !sections) return invalid(issues);
  return { valid: true, checklist: { schemaVersion: 1, templateId: FIELD_READINESS_CHECKLIST_TEMPLATE_ID, templateVersion: 1, checklistId, briefId, createdAtUtc, updatedAtUtc, sections }, issues: [] };
}

function normalizeSections(input: unknown, issues: string[]): readonly FieldReadinessChecklistSection[] | null {
  if (!Array.isArray(input) || input.length !== 2) { issues.push('sections must contain exactly two items.'); return null; }
  const sections: FieldReadinessChecklistSection[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of input.entries()) {
    if (!isRecord(candidate)) { issues.push(`sections[${index}] must be an object.`); continue; }
    requireExactKeys(candidate, ['sectionId', 'title', 'items'], issues, `sections[${index}]`);
    if (!isExpectedSectionId(candidate.sectionId)) issues.push(`sections[${index}].sectionId is unsupported.`);
    if (ids.has(String(candidate.sectionId))) issues.push(`sections[${index}].sectionId is duplicated.`);
    ids.add(String(candidate.sectionId));
    const title = boundedText(candidate.title, `sections[${index}].title`, FIELD_READINESS_CHECKLIST_MAX_SECTION_TITLE_LENGTH, issues);
    const items = normalizeItems(candidate.items, index, issues);
    if (isExpectedSectionId(candidate.sectionId) && title && items) sections.push({ sectionId: candidate.sectionId, title, items });
  }
  if (sections.length !== 2 || sections[0]?.sectionId !== 'field_setup' || sections[1]?.sectionId !== 'operating_readiness') issues.push('sections must use the exact v1 order.');
  return issues.some(issue => issue.startsWith('sections')) ? null : sections;
}

function normalizeItems(input: unknown, sectionIndex: number, issues: string[]): readonly FieldReadinessChecklistItem[] | null {
  if (!Array.isArray(input) || input.length !== 7) { issues.push(`sections[${sectionIndex}].items has an invalid count.`); return null; }
  const items: FieldReadinessChecklistItem[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of input.entries()) {
    if (!isRecord(candidate)) { issues.push(`sections[${sectionIndex}].items[${index}] must be an object.`); continue; }
    requireExactKeys(candidate, ['itemId', 'text', 'completed'], issues, `sections[${sectionIndex}].items[${index}]`);
    if (!isExpectedItemId(candidate.itemId)) issues.push(`sections[${sectionIndex}].items[${index}].itemId is unsupported.`);
    if (ids.has(String(candidate.itemId))) issues.push(`sections[${sectionIndex}].items[${index}].itemId is duplicated.`);
    ids.add(String(candidate.itemId));
    const text = boundedText(candidate.text, `sections[${sectionIndex}].items[${index}].text`, FIELD_READINESS_CHECKLIST_MAX_ITEM_TEXT_LENGTH, issues);
    if (typeof candidate.completed !== 'boolean') issues.push(`sections[${sectionIndex}].items[${index}].completed must be a boolean.`);
    if (isExpectedItemId(candidate.itemId) && text && typeof candidate.completed === 'boolean') items.push({ itemId: candidate.itemId, text, completed: candidate.completed });
  }
  const expected = TEMPLATE_SECTIONS[sectionIndex].items.map(item => item.itemId);
  if (items.map(item => item.itemId).join('|') !== expected.join('|')) issues.push(`sections[${sectionIndex}].items must use the exact v1 order.`);
  return issues.some(issue => issue.startsWith(`sections[${sectionIndex}].items`)) ? null : items;
}

function requireExactKeys(input: Record<string, any>, keys: readonly string[], issues: string[], prefix = ''): void { const expected = new Set(keys); for (const key of Object.keys(input)) if (!expected.has(key)) issues.push(`${prefix || 'checklist'} contains unexpected field ${key}.`); for (const key of keys) if (!(key in input)) issues.push(`${prefix || 'checklist'} is missing field ${key}.`); }
function boundedText(input: unknown, field: string, maximum: number, issues: string[]): string | null { if (typeof input !== 'string' || !input.trim() || input.trim().length > maximum) { issues.push(`${field} must be nonblank text no longer than ${maximum} characters.`); return null; } return input; }
function normalizeId(input: unknown, field: string, issues: string[]): string | null { if (typeof input !== 'string' || !isValidFieldReadinessChecklistId(input)) { issues.push(`${field} is malformed.`); return null; } return input; }
function normalizeUtcTimestamp(input: unknown, field: string, issues: string[]): string | null { if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input) || Number.isNaN(Date.parse(input))) { issues.push(`${field} must be a valid UTC timestamp.`); return null; } return new Date(input).toISOString(); }
function utcNow(now: (() => Date) | undefined): string { const value = (now ?? (() => new Date()))(); if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('The checklist clock returned an invalid date.'); return value.toISOString(); }
export function isValidFieldReadinessChecklistId(input: unknown): input is string { return typeof input === 'string' && input.length > 0 && input.length <= FIELD_READINESS_CHECKLIST_MAX_ID_LENGTH && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(input); }
export function isValidFieldReadinessChecklistItemId(input: unknown): input is FieldReadinessChecklistItemId { return isExpectedItemId(input); }
function isExpectedSectionId(input: unknown): input is FieldReadinessChecklistSectionId { return input === 'field_setup' || input === 'operating_readiness'; }
function isExpectedItemId(input: unknown): input is FieldReadinessChecklistItemId { return typeof input === 'string' && TEMPLATE_SECTIONS.some(section => section.items.some(item => item.itemId === input)); }
function cloneSections(sections: readonly FieldReadinessChecklistSection[]): FieldReadinessChecklistSection[] { return sections.map(section => ({ ...section, items: section.items.map(item => ({ ...item })) })); }
function invalid(issues: readonly string[]): FieldReadinessChecklistNormalizationResult { return { valid: false, checklist: null, issues }; }
function validationError(issues: readonly string[]): Error { return new Error(`The field readiness checklist is invalid: ${issues.join(' ')}`); }
function isRecord(input: unknown): input is Record<string, any> { return typeof input === 'object' && input !== null && !Array.isArray(input); }