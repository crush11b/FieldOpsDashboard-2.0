import { PRODUCT_METADATA } from '../productMetadata';
import type { LogEntry } from '../types';
import type { Qso } from '../../server/qso';

function field(name: string, value: string): string {
  return `<${name}:${value.length}>${value}`;
}

export function createAdifExport(logs: readonly LogEntry[]): string {
  let adif = `ADIF Export from ${PRODUCT_METADATA.productName} ${PRODUCT_METADATA.displayVersion}\n<HEADER>\n`;
  adif += `${field('ADIF_VER', '3.1.0')}\n`;
  adif += `${field('PROGRAMID', PRODUCT_METADATA.adifProgramId)}\n`;
  adif += `${field('PROGRAMVERSION', PRODUCT_METADATA.adifProgramVersion)}\n<EOH>\n`;

  for (const log of logs) {
    adif += `${field('CALL', log.callsign)} ${field('BAND', log.band)} ${field('MODE', log.mode)} `;
    adif += `${field('FREQ', log.frequency)} ${field('RST_SENT', log.rstSent)} ${field('RST_RCVD', log.rstRcvd)} `;
    adif += `${field('GRIDSQUARE', log.gridSquare)} ${field('MY_POTA_REF', log.potaRef ?? '')} <EOR>\n`;
  }

  return adif;
}

export function createActivationAdifExport(qsos: readonly Qso[], context: { readonly type: 'POTA' | 'SOTA' | 'General'; readonly reference?: string; readonly stationCallsign?: string; readonly operatorCallsign?: string; readonly myGridSquare?: string }): string {
  let adif = `ADIF Export from ${PRODUCT_METADATA.productName} ${PRODUCT_METADATA.displayVersion}\n${field('ADIF_VER', '3.1.0')}\n${field('PROGRAMID', PRODUCT_METADATA.adifProgramId)}\n${field('PROGRAMVERSION', PRODUCT_METADATA.adifProgramVersion)}\n<EOH>\n`;
  for (const qso of qsos) {
    const values: Array<[string, string | number | undefined]> = [['QSO_DATE', qso.qsoDateTimeUtc.slice(0, 10).replaceAll('-', '')], ['TIME_ON', qso.qsoDateTimeUtc.slice(11, 19).replaceAll(':', '')], ['CALL', qso.callsign], ['BAND', qso.band], ['FREQ', qso.frequencyMHz?.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')], ['MODE', qso.mode], ['SUBMODE', qso.submode], ['RST_SENT', qso.rstSent], ['RST_RCVD', qso.rstReceived], ['STATION_CALLSIGN', qso.stationCallsign || context.stationCallsign], ['OPERATOR', qso.operatorCallsign || context.operatorCallsign], ['MY_GRIDSQUARE', qso.myGridSquare || context.myGridSquare], ['GRIDSQUARE', qso.gridSquare], ['POTA_REF', qso.potaRef || (context.type === 'POTA' ? context.reference : undefined)], ['SOTA_REF', qso.sotaRef || (context.type === 'SOTA' ? context.reference : undefined)], ['COMMENT', qso.notes]];
    adif += values.filter(([, value]) => value !== undefined && value !== '').map(([name, value]) => field(name, String(value))).join(' ') + ' <EOR>\n';
  }
  return adif;
}
