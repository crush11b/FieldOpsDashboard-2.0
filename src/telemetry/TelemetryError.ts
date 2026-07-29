/** Structured error metadata carried with a telemetry reading. */
export interface TelemetryError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: string;
}
