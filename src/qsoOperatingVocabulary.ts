export interface OperatingOption {
  readonly value: string;
  readonly label: string;
}

export const AMATEUR_BAND_OPTIONS: readonly OperatingOption[] = [
  { value: '160m', label: '160 m' }, { value: '80m', label: '80 m' },
  { value: '60m', label: '60 m' }, { value: '40m', label: '40 m' },
  { value: '30m', label: '30 m' }, { value: '20m', label: '20 m' },
  { value: '17m', label: '17 m' }, { value: '15m', label: '15 m' },
  { value: '12m', label: '12 m' }, { value: '10m', label: '10 m' },
  { value: '6m', label: '6 m' }, { value: '2m', label: '2 m' },
  { value: '70cm', label: '70 cm' }, { value: '23cm', label: '23 cm' },
];

export const OPERATING_MODE_OPTIONS: readonly OperatingOption[] = [
  { value: 'SSB', label: 'SSB' }, { value: 'CW', label: 'CW' },
  { value: 'FM', label: 'FM' }, { value: 'AM', label: 'AM' },
  { value: 'FT8', label: 'FT8' }, { value: 'FT4', label: 'FT4' },
  { value: 'JS8', label: 'JS8' }, { value: 'RTTY', label: 'RTTY' },
];

const DIGITAL_FREQUENCY_DEFAULTS: Readonly<Record<string, number>> = {
  '160m/FT8': 1.84, '80m/FT8': 3.573, '40m/FT8': 7.074, '30m/FT8': 10.136,
  '20m/FT8': 14.074, '17m/FT8': 18.1, '15m/FT8': 21.074, '12m/FT8': 24.915,
  '10m/FT8': 28.074, '6m/FT8': 50.313,
  '160m/FT4': 1.84, '80m/FT4': 3.575, '40m/FT4': 7.0475, '30m/FT4': 10.14,
  '20m/FT4': 14.08, '17m/FT4': 18.104, '15m/FT4': 21.14, '12m/FT4': 24.919,
  '10m/FT4': 28.18, '6m/FT4': 50.318,
};

export function getConventionalFrequencyMHz(band: string, mode: string): number | undefined {
  return DIGITAL_FREQUENCY_DEFAULTS[`${band.toLowerCase()}/${mode.toUpperCase()}`];
}