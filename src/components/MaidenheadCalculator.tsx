import React, { useState } from 'react';
import { Calculator, Copy } from 'lucide-react';
import type { Coordinates } from '../location/coordinates';
import { parseCoordinates } from '../location/coordinates';
import { calculateDistanceKm, calculateDistanceMiles, calculateInitialBearing, compassDirection } from '../location/geography';
import { coordinatesToMaidenhead, maidenheadToCell, type MaidenheadCell } from '../location/maidenhead';
import type { OperatingLocation } from '../location/operatingLocation';

interface MaidenheadCalculatorProps {
  operatingLocation: OperatingLocation;
}

interface CalculatorResult {
  readonly coordinates: Coordinates;
  readonly cell: MaidenheadCell | null;
  readonly locators: Readonly<Record<4 | 6 | 8, string>>;
}

export const MaidenheadCalculator: React.FC<MaidenheadCalculatorProps> = ({ operatingLocation }) => {
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [locator, setLocator] = useState('');
  const [result, setResult] = useState<CalculatorResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const setCoordinateResult = (coordinates: Coordinates, cell: MaidenheadCell | null) => {
    setResult({
      coordinates,
      cell,
      locators: {
        4: coordinatesToMaidenhead(coordinates.lat, coordinates.lon, 4)!,
        6: coordinatesToMaidenhead(coordinates.lat, coordinates.lon, 6)!,
        8: coordinatesToMaidenhead(coordinates.lat, coordinates.lon, 8)!,
      },
    });
    setMessage(null);
  };

  const calculateFromCoordinates = () => {
    const coordinates = parseCoordinates(latitude, longitude);
    if (!coordinates) {
      setResult(null);
      setMessage('ENTER A VALID LATITUDE (-90 TO 90) AND LONGITUDE (-180 TO 180).');
      return;
    }
    setCoordinateResult(coordinates, null);
  };

  const calculateFromLocator = () => {
    const cell = maidenheadToCell(locator);
    if (!cell) {
      setResult(null);
      setMessage('ENTER A VALID 4-, 6-, OR 8-CHARACTER MAIDENHEAD LOCATOR.');
      return;
    }
    setLocator(cell.locator);
    setCoordinateResult(cell.center, cell);
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`COPIED ${value}`);
    } catch {
      setMessage('COPY UNAVAILABLE. SELECT THE VALUE MANUALLY.');
    }
  };

  const distance = result && operatingLocation.coordinates
    ? {
      km: calculateDistanceKm(operatingLocation.coordinates, result.coordinates),
      miles: calculateDistanceMiles(operatingLocation.coordinates, result.coordinates),
      bearing: calculateInitialBearing(operatingLocation.coordinates, result.coordinates),
    }
    : null;

  return (
    <div id="field-tools-maidenhead" className="space-y-4">
      <div className="p-4 rounded-xl border border-cyan-700/70 bg-cyan-950/20 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-black text-sm uppercase text-cyan-300 flex items-center gap-2">
              <Calculator className="w-4 h-4" /> MAIDENHEAD CALCULATOR
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">Convert coordinates and locators locally without changing operating or Activation data.</p>
          </div>
          <span className="px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-[10px] font-black text-emerald-300 whitespace-nowrap">OFFLINE READY</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <section className="p-3 rounded-lg border border-slate-700 bg-slate-950/60 space-y-3">
            <h4 className="font-black text-xs text-cyan-300">COORDINATES TO LOCATOR</h4>
            <label className="block text-[10px] uppercase text-slate-400">Latitude
              <input aria-label="Maidenhead latitude" inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} className="mt-1 min-h-11 w-full px-3 bg-slate-900 border border-slate-700 rounded text-cyan-200 font-bold font-mono" placeholder="-90 to 90" />
            </label>
            <label className="block text-[10px] uppercase text-slate-400">Longitude
              <input aria-label="Maidenhead longitude" inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} className="mt-1 min-h-11 w-full px-3 bg-slate-900 border border-slate-700 rounded text-cyan-200 font-bold font-mono" placeholder="-180 to 180" />
            </label>
            <button onClick={calculateFromCoordinates} className="fo-control min-h-11 w-full rounded border font-black">CALCULATE LOCATORS</button>
          </section>

          <section className="p-3 rounded-lg border border-slate-700 bg-slate-950/60 space-y-3">
            <h4 className="font-black text-xs text-amber-300">LOCATOR TO CENTER</h4>
            <label className="block text-[10px] uppercase text-slate-400">Maidenhead locator
              <input aria-label="Maidenhead locator" value={locator} onChange={(event) => setLocator(event.target.value)} className="mt-1 min-h-11 w-full px-3 bg-slate-900 border border-slate-700 rounded text-amber-200 font-bold font-mono uppercase" placeholder="FM17gj44" maxLength={8} />
            </label>
            <p className="text-[11px] text-slate-400">Returns the representative center of the locator cell, not an exact station position.</p>
            <button onClick={calculateFromLocator} className="fo-control min-h-11 w-full rounded border font-black">CALCULATE CENTER</button>
          </section>
        </div>

        {message && <div role="status" className="rounded-lg border border-amber-600/70 bg-amber-950/30 p-3 text-amber-200 font-bold text-[11px]">{message}</div>}

        {result && (
          <div className="space-y-3" data-testid="maidenhead-results">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {([4, 6, 8] as const).map((precision) => (
                <div key={precision} className="p-3 rounded-lg border border-slate-700 bg-slate-950/70">
                  <span className="block text-[10px] text-slate-400">{precision}-CHARACTER</span>
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-lg tracking-widest text-cyan-200">{result.locators[precision]}</strong>
                    <button aria-label={`Copy ${result.locators[precision]}`} onClick={() => copy(result.locators[precision])} className="fo-control min-h-11 min-w-11 rounded border flex items-center justify-center"><Copy className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 rounded-lg border border-slate-700 bg-slate-950/70">
              <span className="block text-[10px] text-slate-400">{result.cell ? 'REPRESENTATIVE CELL CENTER' : 'ENTERED COORDINATES'}</span>
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm text-amber-200">{result.coordinates.lat.toFixed(6)}°, {result.coordinates.lon.toFixed(6)}°</strong>
                <button aria-label="Copy coordinates" onClick={() => copy(`${result.coordinates.lat.toFixed(6)}, ${result.coordinates.lon.toFixed(6)}`)} className="fo-control min-h-11 min-w-11 rounded border flex items-center justify-center"><Copy className="w-4 h-4" /></button>
              </div>
              {result.cell && <p className="mt-1 text-[10px] text-slate-400">Cell spans approximately {result.cell.latitudeSpanDegrees.toFixed(6)}° latitude × {result.cell.longitudeSpanDegrees.toFixed(6)}° longitude.</p>}
            </div>

            <div className="p-3 rounded-lg border border-emerald-700/60 bg-emerald-950/20">
              <span className="block text-[10px] text-emerald-300">FROM OPERATING LOCATION</span>
              {distance ? (
                <strong className="block mt-1 text-emerald-200">{distance.miles.toFixed(2)} mi / {distance.km.toFixed(2)} km · {distance.bearing === null ? 'Same point' : `${distance.bearing.toFixed(1)}° ${compassDirection(distance.bearing)}`}</strong>
              ) : <span className="block mt-1 text-slate-400">Unavailable: no valid operating location.</span>}
            </div>
          </div>
        )}

        <p className="border-t border-cyan-800/60 pt-3 text-[11px] text-slate-300">Calculation only. Results do not update GNSS, the manual operating location, or an active Activation. Shorter locators cover larger areas; decoded coordinates are cell centers.</p>
      </div>
    </div>
  );
};
