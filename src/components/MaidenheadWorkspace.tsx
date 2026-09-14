import React, { useMemo, useState } from 'react';
import { Check, Copy, LocateFixed } from 'lucide-react';
import { parseCoordinates } from '../location/coordinates';
import {
  latLonToMaidenhead,
  maidenheadToLocation,
  type MaidenheadPrecision,
} from '../location/maidenhead';
import {
  calculateDistanceKm,
  calculateDistanceMiles,
  calculateInitialBearing,
  compassDirection,
} from '../location/geography';
import type { OperatingLocation } from '../location/operatingLocation';

interface MaidenheadWorkspaceProps {
  operatingLocation: OperatingLocation;
}

const PRECISIONS: readonly MaidenheadPrecision[] = [4, 6, 8];

export const MaidenheadWorkspace: React.FC<MaidenheadWorkspaceProps> = ({ operatingLocation }) => {
  const [latitude, setLatitude] = useState(() => operatingLocation.coordinates?.lat.toString() ?? '');
  const [longitude, setLongitude] = useState(() => operatingLocation.coordinates?.lon.toString() ?? '');
  const [locator, setLocator] = useState(() => operatingLocation.gridSquare ?? '');
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const coordinates = useMemo(() => parseCoordinates(latitude, longitude), [latitude, longitude]);
  const decoded = useMemo(() => maidenheadToLocation(locator), [locator]);
  const pathFromOperatingLocation = useMemo(() => {
    if (!decoded || !operatingLocation.coordinates) return null;
    return {
      distanceKm: calculateDistanceKm(operatingLocation.coordinates, decoded.center),
      distanceMiles: calculateDistanceMiles(operatingLocation.coordinates, decoded.center),
      bearing: calculateInitialBearing(operatingLocation.coordinates, decoded.center),
    };
  }, [decoded, operatingLocation.coordinates]);

  const useOperatingLocation = () => {
    if (!operatingLocation.coordinates) return;
    setLatitude(operatingLocation.coordinates.lat.toString());
    setLongitude(operatingLocation.coordinates.lon.toString());
    setLocator(latLonToMaidenhead(operatingLocation.coordinates.lat, operatingLocation.coordinates.lon, 6));
  };

  const copyText = async (key: string, value: string) => {
    try {
      await writeClipboard(value);
      setCopyStatus(key);
    } catch {
      setCopyStatus('unavailable');
    }
  };

  return (
    <div id="maidenhead-workspace" className="p-4 rounded-xl border border-amber-700/70 bg-amber-950/20 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-black text-sm uppercase text-amber-300 flex items-center gap-2">
            <LocateFixed className="w-4 h-4" /> MAIDENHEAD WORKSPACE
          </h3>
          <p className="text-[11px] text-slate-400 mt-1">Offline coordinate conversion and path calculation.</p>
        </div>
        <span className="px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-[10px] font-black text-amber-300 whitespace-nowrap">
          OFFLINE READY
        </span>
      </div>

      <section aria-labelledby="coordinates-to-maidenhead" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h4 id="coordinates-to-maidenhead" className="font-black text-[11px] uppercase text-slate-200">Coordinates to locator</h4>
          <button
            type="button"
            onClick={useOperatingLocation}
            disabled={!operatingLocation.coordinates}
            className="px-2.5 py-1.5 rounded border border-slate-600 text-[10px] font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            USE OPERATING LOCATION
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-[10px] uppercase text-slate-400">
            Calculator latitude
            <input
              type="text"
              inputMode="decimal"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              className="mt-1 w-full px-2.5 py-2 bg-slate-900 border border-slate-700 rounded text-amber-200 font-bold font-mono"
              placeholder="-90 to 90"
            />
          </label>
          <label className="block text-[10px] uppercase text-slate-400">
            Calculator longitude
            <input
              type="text"
              inputMode="decimal"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              className="mt-1 w-full px-2.5 py-2 bg-slate-900 border border-slate-700 rounded text-amber-200 font-bold font-mono"
              placeholder="-180 to 180"
            />
          </label>
        </div>

        {coordinates ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {PRECISIONS.map((precision) => {
              const value = latLonToMaidenhead(coordinates.lat, coordinates.lon, precision);
              const key = `locator-${precision}`;
              return (
                <div key={precision} className="p-3 rounded-lg border border-slate-700 bg-slate-950/70">
                  <span className="block text-[10px] uppercase text-slate-400">{precision}-character</span>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <strong className="font-mono text-base tracking-widest text-amber-200">{value}</strong>
                    <CopyButton copied={copyStatus === key} label={`Copy ${precision}-character locator`} onClick={() => void copyText(key, value)} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-[11px] font-bold text-amber-200">
            ENTER A VALID LATITUDE AND LONGITUDE.
          </p>
        )}
      </section>

      <section aria-labelledby="maidenhead-to-center" className="space-y-3 border-t border-amber-800/60 pt-4">
        <h4 id="maidenhead-to-center" className="font-black text-[11px] uppercase text-slate-200">Locator to representative center</h4>
        <label className="block text-[10px] uppercase text-slate-400">
          Maidenhead locator (4, 6, or 8 characters)
          <input
            type="text"
            value={locator}
            maxLength={8}
            onChange={(event) => setLocator(event.target.value.replace(/\s/g, ''))}
            className="mt-1 w-full px-2.5 py-2 bg-slate-900 border border-slate-700 rounded text-amber-200 font-bold font-mono tracking-widest"
            placeholder="AA00aa"
          />
        </label>

        {decoded ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="p-3 rounded-lg border border-slate-700 bg-slate-950/70">
                <span className="block text-[10px] uppercase text-slate-400">Canonical locator</span>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <strong className="font-mono text-base tracking-widest text-amber-200">{decoded.locator}</strong>
                  <CopyButton copied={copyStatus === 'decoded-locator'} label="Copy canonical locator" onClick={() => void copyText('decoded-locator', decoded.locator)} />
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-700 bg-slate-950/70">
                <span className="block text-[10px] uppercase text-slate-400">Center latitude</span>
                <strong className="block mt-1 font-mono text-sm text-amber-200">{decoded.center.lat.toFixed(6)}°</strong>
              </div>
              <div className="p-3 rounded-lg border border-slate-700 bg-slate-950/70">
                <span className="block text-[10px] uppercase text-slate-400">Center longitude</span>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <strong className="font-mono text-sm text-amber-200">{decoded.center.lon.toFixed(6)}°</strong>
                  <CopyButton
                    copied={copyStatus === 'center'}
                    label="Copy center coordinates"
                    onClick={() => void copyText('center', `${decoded.center.lat.toFixed(6)}, ${decoded.center.lon.toFixed(6)}`)}
                  />
                </div>
              </div>
            </div>

            {pathFromOperatingLocation ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" id="maidenhead-path-results">
                <Result label="Distance to center" primary={`${pathFromOperatingLocation.distanceMiles.toFixed(2)} mi`} secondary={`${pathFromOperatingLocation.distanceKm.toFixed(2)} km`} />
                <Result label="Initial bearing" primary={pathFromOperatingLocation.bearing === null ? 'N/A' : `${pathFromOperatingLocation.bearing.toFixed(1)}°`} />
                <Result label="Direction" primary={compassDirection(pathFromOperatingLocation.bearing)} />
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">Distance and bearing require a valid current operating location.</p>
            )}

            <p className="text-[10px] text-slate-400">
              Cell span: {decoded.latitudeSpanDegrees.toFixed(6)}° latitude × {decoded.longitudeSpanDegrees.toFixed(6)}° longitude.
            </p>
          </>
        ) : (
          <p className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-[11px] font-bold text-amber-200">
            ENTER A VALID 4-, 6-, OR 8-CHARACTER MAIDENHEAD LOCATOR.
          </p>
        )}
      </section>

      {copyStatus === 'unavailable' && (
        <p className="text-[11px] font-bold text-amber-200" role="status">COPY UNAVAILABLE IN THIS RUNTIME.</p>
      )}
      <p className="border-t border-amber-800/60 pt-3 text-[11px] text-slate-300">
        A decoded locator identifies a cell, not an exact station position. Coordinates shown are the cell's geometric center; distance and initial bearing are estimates to that center.
      </p>
    </div>
  );
};

const CopyButton: React.FC<{ copied: boolean; label: string; onClick: () => void }> = ({ copied, label, onClick }) => (
  <button type="button" aria-label={label} title={label} onClick={onClick} className="p-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">
    {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
  </button>
);

const Result: React.FC<{ label: string; primary: string; secondary?: string }> = ({ label, primary, secondary }) => (
  <div className="p-3 rounded-lg border border-cyan-700/60 bg-cyan-950/20">
    <span className="block text-[10px] uppercase text-cyan-300">{label}</span>
    <strong className="block mt-1 text-base text-cyan-100">{primary}</strong>
    {secondary && <span className="block text-[10px] text-slate-400">{secondary}</span>}
  </div>
);

async function writeClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (typeof document.execCommand !== 'function' || !document.execCommand('copy')) {
      throw new Error('Clipboard API unavailable');
    }
  } finally {
    textarea.remove();
  }
}
