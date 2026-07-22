import React, { useState } from 'react';
import { Navigation, MapPin, Satellite, Edit2, Check, RefreshCw, Compass } from 'lucide-react';
import { GPSStatus, UIThemeMode, latLonToGridSquare, gridSquareToLatLon } from '../types';
import { playTacticalClick } from '../utils/audio';

interface GPSGridWidgetProps {
  gps: GPSStatus;
  theme: UIThemeMode;
  audioEnabled: boolean;
  onUpdateGPS: (updated: Partial<GPSStatus>) => void;
}

export const GPSGridWidget: React.FC<GPSGridWidgetProps> = ({
  gps,
  theme,
  audioEnabled,
  onUpdateGPS,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [inputLat, setInputLat] = useState(gps.lat.toString());
  const [inputLon, setInputLon] = useState(gps.lon.toString());
  const [inputGrid, setInputGrid] = useState(gps.gridSquare);

  const isNight = theme === 'night_vision';
  const isSunlight = theme === 'sunlight';

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

  const handleSaveCoordinates = () => {
    playTacticalClick(audioEnabled);
    let lat = parseFloat(inputLat);
    let lon = parseFloat(inputLon);

    if (isNaN(lat) || isNaN(lon)) {
      // Try parsing Grid Square if given
      const parsed = gridSquareToLatLon(inputGrid);
      if (parsed) {
        lat = parsed.lat;
        lon = parsed.lon;
      } else {
        return;
      }
    }

    const calculatedGrid = latLonToGridSquare(lat, lon);

    onUpdateGPS({
      lat,
      lon,
      gridSquare: calculatedGrid,
      mode: 'manual',
      lockTime: new Date().toLocaleTimeString(),
    });

    setIsEditing(false);
  };

  const handleTriggerBrowserGeolocation = () => {
    playTacticalClick(audioEnabled);
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const grid = latLonToGridSquare(lat, lon);
          onUpdateGPS({
            lat,
            lon,
            altitudeM: Math.round(pos.coords.altitude || 1250),
            speedKmh: Math.round((pos.coords.speed || 0) * 3.6),
            gridSquare: grid,
            satCount: 11,
            fixType: '3D Fix',
            mode: 'auto',
            lockTime: new Date().toLocaleTimeString(),
          });
          setInputLat(lat.toString());
          setInputLon(lon.toString());
          setInputGrid(grid);
        },
        (err) => {
          console.warn('Geolocation failed or denied, using simulated GPS fix', err);
        }
      );
    }
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
            onClick={handleTriggerBrowserGeolocation}
            className={`p-1 rounded border text-[10px] font-bold flex items-center gap-1 active:scale-95 ${
              isNight ? 'border-red-900 bg-red-950 text-red-400' : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
            title="Auto-detect GPS coordinates via Browser / USB GPS"
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
            {gps.gridSquare}
          </span>
          <span className="text-[10px] mt-1 opacity-75">
            {gps.mode === 'auto' ? '🛰️ SATELLITE AUTO-FIX' : '✏️ MANUAL OVERRIDE'}
          </span>
        </div>

        {/* Detailed Position Metrics or Edit Form */}
        <div className="sm:col-span-2">
          {isEditing ? (
            <div className="p-2.5 rounded-lg border border-cyan-800 bg-cyan-950/30 text-xs space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase opacity-75 mb-0.5">Latitude (°N/S)</label>
                  <input
                    id="input-gps-lat"
                    type="number"
                    step="0.0001"
                    value={inputLat}
                    onChange={(e) => setInputLat(e.target.value)}
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-cyan-300 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase opacity-75 mb-0.5">Longitude (°E/W)</label>
                  <input
                    id="input-gps-lon"
                    type="number"
                    step="0.0001"
                    value={inputLon}
                    onChange={(e) => setInputLon(e.target.value)}
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-cyan-300 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase opacity-75 mb-0.5">Direct Grid Square (e.g. CN87ui)</label>
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
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-emerald-400 font-bold text-xs uppercase font-mono"
                />
              </div>

              <button
                id="btn-save-gps-coordinates"
                onClick={handleSaveCoordinates}
                className="w-full py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1 active:scale-95"
              >
                <Check className="w-4 h-4" /> APPLY COORDINATES & RECALCULATE
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className={`p-2 rounded border ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
                <span className="text-[10px] uppercase opacity-70 block">COORDINATES</span>
                <span className="font-bold text-cyan-400">
                  {gps.lat.toFixed(4)}°, {gps.lon.toFixed(4)}°
                </span>
              </div>

              <div className={`p-2 rounded border ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
                <span className="text-[10px] uppercase opacity-70 block">SATELLITES & FIX</span>
                <span className="font-bold text-emerald-400 flex items-center gap-1">
                  <Satellite className="w-3 h-3" /> {gps.satCount} SATS ({gps.fixType})
                </span>
              </div>

              <div className={`p-2 rounded border ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
                <span className="text-[10px] uppercase opacity-70 block">ALTITUDE</span>
                <span className="font-bold">{gps.altitudeM} meters ({Math.round(gps.altitudeM * 3.28084)} ft)</span>
              </div>

              <div className={`p-2 rounded border ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
                <span className="text-[10px] uppercase opacity-70 block">UTC TIME SYNC</span>
                <span className="font-bold text-amber-300">{gps.lockTime || 'SYNCED'}</span>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
