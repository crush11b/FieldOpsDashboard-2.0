import { PRODUCT_METADATA } from '../productMetadata';
import type { LogEntry } from '../types';

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
