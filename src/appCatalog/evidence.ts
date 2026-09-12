export interface FieldOpsEvidenceRelationship {
  readonly kind: 'read-only-evidence';
  readonly label: 'READ-ONLY EVIDENCE';
  readonly description: string;
}

export const FIELDOPS_EVIDENCE_RELATIONSHIPS: Readonly<Record<string, FieldOpsEvidenceRelationship>> = {
  wsjtx: {
    kind: 'read-only-evidence',
    label: 'READ-ONLY EVIDENCE',
    description: 'FieldOps may retain read-only WSJT-X evidence; it does not control the application or radio.',
  },
};

export function getFieldOpsEvidenceRelationship(id: string): FieldOpsEvidenceRelationship | undefined {
  return FIELDOPS_EVIDENCE_RELATIONSHIPS[id];
}