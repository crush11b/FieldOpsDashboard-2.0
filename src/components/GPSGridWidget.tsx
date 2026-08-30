import React, { useState, useEffect, useRef } from 'react';
import { Navigation, MapPin, Satellite, Edit2, Check, RefreshCw, Compass, Lock, Unlock, ChevronDown } from 'lucide-react';
import { GPSProvenance, GPSStatus, UIThemeMode, latLonToGridSquare, gridSquareToLatLon } from '../types';
import { playTacticalClick } from '../utils/audio';
import { parseCoordinates, resolveGpsCoordinates } from '../location/coordinates';
import type { ClockSynchronizationEvidence, GnssRecoveryResult, GnssSerialDiagnostics } from '../../server/locationTelemetryPipe';
import { recoverGnss } from '../gnssRecoveryApi';

interface GPSGridWidgetProps {
  gps: GPSStatus;
  provenance: GPSProvenance;
  theme: UIThemeMode;
  audioEnabled: boolean;
  onUpdateGPS: (updated: Partial<GPSStatus>, provenance?: GPSProvenance) => void;
  comPort?: string;
  baudRate?: number;
  onSelectComPort?: (port: string, baud: number) => void;
  clockEvidence?: ClockSynchronizationEvidence;
  onSynchronizeClock?: () => Promise<void>;
  gnssDiagnostics?: GnssSerialDiagnostics;
}

export const GPSGridWidget: React.FC<GPSGridWidgetProps> = ({
  gps,
  provenance,
  theme,
  audioEnabled,
  onUpdateGPS,
  comPort = 'COM6 (GPS Receiver)',
  baudRate = 9600,
  onSelectComPort,
  clockEvidence,
  onSynchronizeClock,
  gnssDiagnostics,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [inputLat, setInputLat] = useState(Number.isFinite(gps.lat) ? gps.lat.toString() : '');
  const [inputLon, setInputLon] = useState(Number.isFinite(gps.lon) ? gps.lon.toString() : '');
  const [inputGrid, setInputGrid] = useState(gps.gridSquare);
  const [clockConfirmed, setClockConfirmed] = useState(false);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);
  const [serialDiagnostics, setSerialDiagnostics] = useState<GnssSerialDiagnostics | null>(gnssDiagnostics ?? null);
  const [recoveryState, setRecoveryState] = useState<GnssRecoveryResult | null>(null);
  const [recoveryInProgress, setRecoveryInProgress] = useState(false);
  const gpsUpdateSequence = useRef(0);
  const nativeLocationRequest = useRef<() => Promise<void>>(async () => {});
  const nativeRequestInFlight = useRef<Promise<void> | null>(null);
  const manualLocationActive = useRef(
    provenance.source.type === 'manual_location' || provenance.source.type === 'preset_location',
  );
  const displayLocation = resolveGpsCoordinates(gps, provenance);
  const canSaveManualLocation = parseCoordinates(inputLat, inputLon) !== null
    || gridSquareToLatLon(inputGrid) !== null;

  useEffect(() => {
    manualLocationActive.current = provenance.source.type === 'manual_location'
      || provenance.source.type === 'preset_location';
  }, [provenance.source.type]);

  const manualProvenance = (preset = false): GPSProvenance => ({
    status: 'degraded',
    source: {
      id: preset ? 'gps:preset' : 'gps:manual',
      type: preset ? 'preset_location' : 'manual_location',
      name: preset ? 'Preset Location' : 'Manual Location',
    },
  });

  // Sync inputs whenever gps prop changes
  useEffect(() => {
    if (!isEditing) {
      setInputLat(Number.isFinite(gps.lat) ? gps.lat.toString() : '');
      setInputLon(Number.isFinite(gps.lon) ? gps.lon.toString() : '');
      setInputGrid(gps.gridSquare);
    }
  }, [gps.lat, gps.lon, gps.gridSquare, isEditing]);

  // Native NMEA is the sole automatic source; manual overrides remain local and explicit.
  useEffect(() => {
    let cancelled = false;
    const requestNativeLocation = async () => {
      try {
        const res = await fetch('/api/location');
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (manualLocationActive.current || isEditing) return;
        const coordinates = parseCoordinates(data.latitude, data.longitude);
        const observedAt = data.timestampUtc;
        const status = data.status === 'Available' ? 'ok' : data.status === 'NoFix' ? 'connecting' : data.status === 'Initializing' ? 'connecting' : data.status === 'Unavailable' ? 'unavailable' : 'error';
        if (data.status === 'Available' && !coordinates) { onUpdateGPS({ mode: 'auto' }, { status: 'error', source: { id: 'gps:serial-nmea', type: 'serial_nmea', name: 'Internal GNSS / NMEA' }, timestamps: { receivedAt: new Date().toISOString() } }); return; }
        if (!coordinates) { onUpdateGPS({ mode: 'auto' }, { status, source: { id: 'gps:serial-nmea', type: 'serial_nmea', name: 'Internal GNSS / NMEA' }, timestamps: { receivedAt: new Date().toISOString(), ...(observedAt ? { observedAt } : {}) } }); return; }
        const grid = latLonToGridSquare(coordinates.lat, coordinates.lon);
        gpsUpdateSequence.current += 1;
        onUpdateGPS({ lat: coordinates.lat, lon: coordinates.lon, gridSquare: grid, ...(data.altitude === null ? {} : { altitudeM: data.altitude }), ...(data.speed === null ? {} : { speedKmh: data.speed * 3.6 }), ...(data.satellites === null ? {} : { satCount: data.satellites }), fixType: data.fixQuality === null ? undefined : `Fix quality ${data.fixQuality}`, mode: 'auto', lockTime: data.timestampUtc ?? undefined }, { status, source: { id: 'gps:serial-nmea', type: 'serial_nmea', name: 'Internal GNSS / NMEA' }, timestamps: { receivedAt: new Date().toISOString(), observedAt } });
      } catch { /* native location is unavailable; preserve manual state */ }
      return null;
    };
    nativeLocationRequest.current = requestNativeLocation;
    const runRequest = () => { if (!nativeRequestInFlight.current) nativeRequestInFlight.current = requestNativeLocation().then(() => undefined).finally(() => { nativeRequestInFlight.current = null; }); return nativeRequestInFlight.current; };
    runRequest();
    const interval = setInterval(runRequest, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isEditing]);

  useEffect(() => {
    let cancelled = false;
    const requestDiagnostics = async () => {
      try {
        const response = await fetch('/api/location/diagnostics');
        if (!cancelled && response.ok) setSerialDiagnostics(await response.json() as GnssSerialDiagnostics);
      } catch { /* diagnostic transport is optional and must not affect location */ }
    };
    requestDiagnostics();
    const interval = setInterval(requestDiagnostics, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const requestNativeFix = async () => {
    manualLocationActive.current = false;
    if (!nativeRequestInFlight.current) nativeRequestInFlight.current = nativeLocationRequest.current().then(() => undefined).finally(() => { nativeRequestInFlight.current = null; });
    await nativeRequestInFlight.current;
  };
  const isNight = theme === 'night_vision';
  const isSunlight = theme === 'sunlight';
  const hasFreshGnssTime = clockEvidence?.gnssTime?.status === 'Available' && Boolean(clockEvidence.gnssTime.timestampUtc);
  const clockStatus = clockEvidence?.status === 'Synchronized'
    ? 'GPS SYNCHRONIZED'
    : hasFreshGnssTime
      ? 'NOT GPS-SYNCHRONIZED'
      : 'GNSS TIME UNAVAILABLE';
  const formatEvidenceTime = (value: string | null | undefined) => value ? `${new Date(value).toISOString().slice(0, 19).replace('T', ' ')} UTC` : 'Not available';
  const formatDiagnosticTime = (value: string | null | undefined) => value ? `${new Date(value).toISOString().slice(11, 19)} UTC` : '—';
  const diagnosticsUnavailable = serialDiagnostics?.transportStatus === 'unavailable';
  const recoveryAvailable = serialDiagnostics?.lastFailureCategory === 'SerialSilence';
  const recoveryMessage = recoveryState?.state === 'CommandAccepted'
    ? 'GNSS session restarted; waiting for NMEA data.'
    : recoveryState?.state === 'NmeaRecovered'
      ? 'NMEA data recovered; acquiring GPS fix.'
      : recoveryState?.state === 'Recovered'
        ? 'GPS recovered.'
        : recoveryState?.state === 'Failed' || recoveryState?.state === 'TimedOut'
          ? 'GPS recovery did not restore NMEA data.'
          : null;
  const runGnssRecovery = async () => {
    if (recoveryInProgress) return;
    setRecoveryInProgress(true);
    try { setRecoveryState(await recoverGnss()); }
    catch { setRecoveryState({ state: 'Failed', failureCategory: 'UnexpectedError', failureMessage: 'The recovery request failed.', supported: true, available: false, providerType: null, controlPort: null, operationStartedUtc: null, operationCompletedUtc: null, commandAccepted: false, serialActivityRecovered: false, nmeaActivityRecovered: false, fixStatus: 'Error', attemptCount: 0, lastSerialBeforeUtc: null, lastSerialAfterUtc: null, lastNmeaAfterUtc: null }); }
    finally { setRecoveryInProgress(false); }
  };

  const cardBg = isNight
    ? 'bg-black border-red-900/90 text-red-500 rounded-2xl p-4 sm:p-5 shadow-lg'
    : isSunlight
    ? 'bg-white border-amber-400 text-slate-900 shadow-sm rounded-2xl p-4 sm:p-5'
    : 'bg-zinc-900/50 border-zinc-800 text-zinc-100 shadow-lg rounded-2xl p-4 sm:p-5';

  const badgeBg = isNight
    ? 'bg-red-950 border-red-700 text-red-300'
    : isSunlight
    ? 'bg-emerald-200 border-emerald-500 text-slate-950'
    : 'bg-zinc-800/90 border-zinc-700/80 text-zinc-100';

  const gpsStatusText = (() => {
    if (!displayLocation && provenance.status !== 'connecting' && provenance.status !== 'error') {
      return '⚠️ GPS UNAVAILABLE';
    }
    switch (provenance.status) {
      case 'ok':
        return '🛰️ SATELLITE AUTO-FIX';
      case 'cached':
        return '💾 CACHED LAST POSITION';
      case 'stale':
        return '⏱️ STALE LAST POSITION';
      case 'degraded':
        if (provenance.source.type === 'manual_location') return '✏️ MANUAL OVERRIDE';
        if (provenance.source.type === 'preset_location') return '📍 LOCATION PRESET';
        if (provenance.source.type === 'simulated_default') return '📍 REFERENCE LOCATION — NO FIX';
        return '⚠️ DEGRADED LOCATION';
      case 'connecting':
        return '⏳ ACQUIRING GPS';
      case 'unavailable':
        return '⚠️ GPS UNAVAILABLE';
      case 'error':
        return '⚠️ GPS ERROR';
    }
  })();

  const handleSaveCoordinates = () => {
    playTacticalClick(audioEnabled);
    let coordinates = parseCoordinates(inputLat, inputLon);

    if (!coordinates) {
      // Try parsing Grid Square if given
      const parsed = gridSquareToLatLon(inputGrid);
      if (parsed) {
        coordinates = parseCoordinates(parsed.lat, parsed.lon);
      } else {
        return;
      }
    }
    if (!coordinates) return;
    const { lat, lon } = coordinates;

    const calculatedGrid = latLonToGridSquare(lat, lon);
    const lockTime = new Date().toLocaleTimeString() + ' (Manual Lock)';

    manualLocationActive.current = true;
    gpsUpdateSequence.current += 1;
    onUpdateGPS({
      lat,
      lon,
      gridSquare: calculatedGrid,
      mode: 'manual',
      lockTime,
    }, manualProvenance());

    setIsEditing(false);
  };

  const handleApplyPreset = (lat: number, lon: number, name: string) => {
    playTacticalClick(audioEnabled);
    const grid = latLonToGridSquare(lat, lon);
    const lockTime = new Date().toLocaleTimeString() + ' (Preset)';
    manualLocationActive.current = true;
    gpsUpdateSequence.current += 1;
    onUpdateGPS({
      lat,
      lon,
      gridSquare: grid,
      mode: 'manual',
      lockTime,
    }, manualProvenance(true));
    setInputLat(lat.toString());
    setInputLon(lon.toString());
    setInputGrid(grid);
  };

  const handleRequestNativeGpsFix = () => {
    playTacticalClick(audioEnabled);
    manualLocationActive.current = false;
    setIsEditing(false);
    void requestNativeFix();
  };

  return (
    <div className={`p-3.5 rounded-xl border ${cardBg} font-mono transition-all`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-current/15">
        <div className="flex items-center gap-2">
          <Navigation className={`w-4 h-4 ${isNight ? 'text-red-500' : 'text-emerald-400'} animate-spin-slow`} />
          <h3 className="text-xs font-bold uppercase tracking-wider">
            GPS / MAIDENHEAD LOCATION BADGE
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="btn-trigger-gps-refresh"
            aria-label="Request native GPS fix"
            onClick={handleRequestNativeGpsFix}
            className={`p-1 rounded border text-[10px] font-bold flex items-center gap-1 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
              isNight ? 'border-red-900 bg-red-950 text-red-400' : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
            title="Request coordinates from native NMEA GNSS"
          >
            <RefreshCw className="w-3 h-3" /> GPS FIX
          </button>
          
          <button
            id="btn-edit-gps-coordinates"
            onClick={() => {
              playTacticalClick(audioEnabled);
              setIsEditing(!isEditing);
            }}
            className={`p-1 rounded border text-[10px] font-bold flex items-center gap-1 active:scale-95 ${
              isNight ? 'border-red-900 bg-red-950 text-red-400' : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
            title="Manual coordinate override"
          >
            <Edit2 className="w-3 h-3" /> {isEditing ? 'CANCEL' : 'EDIT'}
          </button>
        </div>
      </div>

      {/* Primary Maidenhead Badge Display */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        
        {/* Large 6-digit Grid Badge */}
        <div className={`sm:col-span-1 p-3 rounded-xl border ${badgeBg} flex flex-col items-center justify-center text-center shadow-inner`}>
          <span className="text-[10px] uppercase font-bold tracking-widest opacity-80 mb-0.5">
            6-DIGIT MAIDENHEAD
          </span>
          <span className="text-2xl font-black tracking-widest font-mono text-emerald-400 drop-shadow">
            {displayLocation ? gps.gridSquare || latLonToGridSquare(displayLocation.lat, displayLocation.lon) : '—'}
          </span>
          <span className="text-[10px] mt-1 opacity-75">
            {gpsStatusText}
          </span>
        </div>

        {/* Detailed Position Metrics or Edit Form */}
        <div className="sm:col-span-2">
          {isEditing ? (
            <div className="p-2.5 rounded-lg border border-cyan-800 bg-cyan-950/30 text-xs space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase opacity-75 mb-0.5 font-bold text-cyan-300">Latitude (°N/S)</label>
                  <input
                    id="input-gps-lat"
                    type="number"
                    step="0.0001"
                    value={inputLat}
                    onChange={(e) => {
                      setInputLat(e.target.value);
                      const coordinates = parseCoordinates(e.target.value, inputLon);
                      if (coordinates) {
                        setInputGrid(latLonToGridSquare(coordinates.lat, coordinates.lon));
                      }
                    }}
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-cyan-300 text-xs font-mono focus:border-cyan-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase opacity-75 mb-0.5 font-bold text-cyan-300">Longitude (°E/W)</label>
                  <input
                    id="input-gps-lon"
                    type="number"
                    step="0.0001"
                    value={inputLon}
                    onChange={(e) => {
                      setInputLon(e.target.value);
                      const coordinates = parseCoordinates(inputLat, e.target.value);
                      if (coordinates) {
                        setInputGrid(latLonToGridSquare(coordinates.lat, coordinates.lon));
                      }
                    }}
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-cyan-300 text-xs font-mono focus:border-cyan-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase opacity-75 mb-0.5 font-bold text-emerald-400">Direct 4/6-Digit Grid Square (e.g. FM17hd, CN87, DM79)</label>
                <input
                  id="input-gps-grid-square"
                  type="text"
                  maxLength={6}
                  value={inputGrid}
                  onChange={(e) => {
                    const val = e.target.value;
                    setInputGrid(val);
                    const parsed = gridSquareToLatLon(val);
                    if (parsed) {
                      setInputLat(parsed.lat.toFixed(4));
                      setInputLon(parsed.lon.toFixed(4));
                    }
                  }}
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-emerald-400 font-bold text-xs uppercase font-mono tracking-wider focus:border-emerald-400 focus:outline-none"
                />
              </div>

              {/* Quick Presets for Field Ops */}
              <div>
                <span className="block text-[9px] uppercase opacity-60 mb-1 font-mono">Quick Region Presets:</span>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(37.5407, -77.4360, 'Richmond, VA')}
                    className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-zinc-700"
                  >
                    Richmond (FM17hd)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(47.6062, -122.3321, 'Seattle, WA')}
                    className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-zinc-700"
                  >
                    Seattle (CN87)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(39.7392, -104.9903, 'Denver, CO')}
                    className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-zinc-700"
                  >
                    Denver (DM79)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(32.7767, -96.7970, 'Dallas, TX')}
                    className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-zinc-700"
                  >
                    Dallas (EM12)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(41.8781, -87.6298, 'Chicago, IL')}
                    className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-zinc-700"
                  >
                    Chicago (EN51)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(34.0522, -118.2437, 'Los Angeles, CA')}
                    className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-zinc-700"
                  >
                    LA (DM04)
                  </button>
                </div>
              </div>

              <button
                id="btn-save-gps-coordinates"
                disabled={!canSaveManualLocation}
                onClick={handleSaveCoordinates}
                title={canSaveManualLocation ? 'Save manual operating location' : 'Enter valid coordinates or a Maidenhead grid square'}
                className="w-full py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 shadow disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Lock className="w-3.5 h-3.5" /> SAVE & PERMANENTLY LOCK LOCATION
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className={`p-2 rounded border ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
                <span className="text-[10px] uppercase opacity-70 block">COORDINATES</span>
                <span className="font-bold text-cyan-400">
                  {displayLocation ? `${displayLocation.lat.toFixed(4)}°, ${displayLocation.lon.toFixed(4)}°` : 'Unavailable'}
                </span>
              </div>

              <div className={`p-2 rounded border ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
                <span className="text-[10px] uppercase opacity-70 block">SATELLITES & FIX</span>
                <span className="font-bold text-emerald-400 flex items-center gap-1">
                  <Satellite className="w-3 h-3" /> {displayLocation ? `${gps.satCount} SATS (${gps.fixType})` : 'Waiting for location'}
                </span>
              </div>

              <div className={`p-2 rounded border ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
                <span className="text-[10px] uppercase opacity-70 block">ALTITUDE</span>
                <span className="font-bold">{displayLocation ? `${gps.altitudeM} meters (${Math.round(gps.altitudeM * 3.28084)} ft)` : 'Unavailable'}</span>
              </div>

              <div className={`p-2 rounded border ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
                <span className="text-[10px] uppercase opacity-70 block">GNSS UTC TIME</span>
                <span className="font-bold text-amber-300">{hasFreshGnssTime ? formatEvidenceTime(clockEvidence?.gnssTime.timestampUtc) : displayLocation ? gps.lockTime || 'Unknown' : 'Unavailable'}</span>
              </div>

              <div className={`col-span-2 p-2 rounded border ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
                <span className="text-[10px] uppercase opacity-70 block">WINDOWS CLOCK</span>
                <span className={`font-bold ${clockEvidence?.status === 'Synchronized' ? 'text-emerald-400' : 'text-amber-300'}`}>{clockStatus}</span>
                <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-1 text-[10px] opacity-85">
                  <span>LAST GPS SYNC: {formatEvidenceTime(clockEvidence?.lastSuccessfulSynchronizationUtc)}</span>
                  <span>CALCULATED OFFSET: {typeof (clockEvidence?.currentOffsetSeconds ?? clockEvidence?.offsetBeforeSynchronizationSeconds) === 'number' ? `${(clockEvidence.currentOffsetSeconds ?? clockEvidence.offsetBeforeSynchronizationSeconds)!.toFixed(3)} s` : 'Not available'}</span>
                  <span>SOURCE: FieldOps Agent / COM6</span>
                </div>
                {onSynchronizeClock && <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1 text-[10px]"><input type="checkbox" checked={clockConfirmed} onChange={event => setClockConfirmed(event.currentTarget.checked)} /> CONFIRM WINDOWS CLOCK SYNC</label>
                  <button type="button" disabled={!clockConfirmed} onClick={() => { void onSynchronizeClock().then(() => setClockConfirmed(false)); }} className="px-2 py-1 rounded border border-cyan-700 text-cyan-200 text-[10px] font-bold disabled:opacity-40">SYNCHRONIZE WINDOWS CLOCK</button>
                </div>}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Satellite Serial GNSS COM Port Interface Bar */}
      <div className={`mt-3 pt-2.5 border-t border-current/15 flex flex-wrap items-center justify-between text-xs gap-2 font-mono ${
        isNight ? 'text-red-400' : isSunlight ? 'text-slate-800' : 'text-zinc-300'
      }`}>
        <div className="flex items-center gap-2">
          <Satellite className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-300">
            GNSS SERIAL PORT:
          </span>
          <select
            id="select-widget-com-port"
            value={gps.comPort || comPort}
            onChange={(e) => {
              playTacticalClick(audioEnabled);
              const newPort = e.target.value;
              if (onSelectComPort) onSelectComPort(newPort, baudRate);
              onUpdateGPS({ comPort: newPort, deviceName: `GPS Receiver (${newPort})` });
            }}
            className="px-2 py-0.5 bg-slate-950 border border-cyan-500/40 rounded font-bold text-[11px] text-amber-300"
          >
            <option value="COM6 (GPS Receiver)">COM6 (Configured GNSS Port)</option>
            <option value="COM6">COM6 (Standard Serial)</option>
            <option value="COM1">COM1 (Standard System Serial)</option>
            <option value="COM2">COM2 (Serial Port 2)</option>
            <option value="COM3">COM3 (USB Serial Adapter)</option>
            <option value="COM4">COM4 (Serial Port 4)</option>
            <option value="COM5">COM5 (Serial Port 5)</option>
            <option value="COM7">COM7 (Serial Port 7)</option>
            <option value="COM8">COM8 (Serial Port 8)</option>
            <option value="COM9">COM9 (Serial Port 9)</option>
            <option value="COM10">COM10 (Serial Port 10)</option>
            <option value="COM11">COM11 (Serial Port 11)</option>
            <option value="COM12">COM12 (Serial Port 12)</option>
            <option value="COM13">COM13 (Serial Port 13)</option>
            <option value="COM14">COM14 (Serial Port 14)</option>
            <option value="COM15">COM15 (Serial Port 15)</option>
            <option value="COM16">COM16 (Serial Port 16)</option>
            <option value="/dev/ttyUSB0">/dev/ttyUSB0 (Linux USB-Serial)</option>
            <option value="/dev/ttyUSB1">/dev/ttyUSB1 (Linux USB-Serial 2)</option>
            <option value="/dev/ttyACM0">/dev/ttyACM0 (Linux USB Modem/GNSS)</option>
            <option value="AUTO_DETECT">⚡ Auto-Detect Satellite Dongle</option>
          </select>
        </div>

        <div className="flex items-center gap-3 text-[10px]">
          <span className="px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-black">
            NMEA @ {baudRate} BAUD
          </span>
          <span className="text-zinc-400 hidden sm:inline">
            DIRECT GNSS HARDWARE STREAM
          </span>
        </div>
      </div>

      <div className="mt-2 border-t border-current/15 pt-2">
        <button
          type="button"
          aria-expanded={diagnosticsExpanded}
          onClick={() => setDiagnosticsExpanded(!diagnosticsExpanded)}
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider opacity-80 hover:opacity-100"
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${diagnosticsExpanded ? 'rotate-180' : ''}`} />
          GNSS Diagnostics
        </button>
        {diagnosticsExpanded && (
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[10px]" data-testid="gnss-diagnostics">
            <span>PORT <strong>{diagnosticsUnavailable ? 'Unavailable' : serialDiagnostics ? `${serialDiagnostics.portName} @ ${serialDiagnostics.baudRate}` : '—'}</strong></span>
            <span>STATE <strong>{diagnosticsUnavailable ? 'Unavailable' : serialDiagnostics?.state ?? '—'}</strong></span>
            <span>SESSION <strong>{diagnosticsUnavailable ? '—' : serialDiagnostics?.sessionGeneration ?? '—'}</strong></span>
            <span>RECONNECTS <strong>{diagnosticsUnavailable ? '—' : serialDiagnostics?.reconnectCount ?? '—'}</strong></span>
            <span>LAST OPEN <strong>{diagnosticsUnavailable ? '—' : formatDiagnosticTime(serialDiagnostics?.lastSuccessfulOpenUtc)}</strong></span>
            <span>LAST SERIAL <strong>{diagnosticsUnavailable ? '—' : formatDiagnosticTime(serialDiagnostics?.lastSerialDataUtc)}</strong></span>
            <span>LAST NMEA <strong>{diagnosticsUnavailable ? '—' : formatDiagnosticTime(serialDiagnostics?.lastValidNmeaUtc)}</strong></span>
            <span>LAST FIX <strong>{diagnosticsUnavailable ? '—' : formatDiagnosticTime(serialDiagnostics?.lastFixUtc)}</strong></span>
            <span className="col-span-2 sm:col-span-4">FAILURE <strong>{diagnosticsUnavailable ? 'diagnostic_transport_unavailable' : serialDiagnostics?.lastFailureCategory ?? '—'}{!diagnosticsUnavailable && serialDiagnostics?.lastFailureMessage ? `: ${serialDiagnostics.lastFailureMessage}` : ''}</strong></span>
            <div className="col-span-2 sm:col-span-4 mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={runGnssRecovery}
                disabled={!recoveryAvailable || recoveryInProgress}
                className="inline-flex items-center gap-1 rounded border border-amber-400/50 px-2 py-1 font-bold uppercase tracking-wider text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw className={`h-3 w-3 ${recoveryInProgress ? 'animate-spin' : ''}`} />
                {recoveryInProgress ? 'Recovering GPS...' : 'Recover GPS'}
              </button>
              {recoveryMessage && <span role="status" className="text-amber-200">{recoveryMessage}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
