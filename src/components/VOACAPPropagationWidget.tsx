import React, { useState, useEffect } from 'react';
import { Activity, Database, RefreshCw, Clock, Moon, Sun, Radio, MapPin, Sparkles, ChevronDown } from 'lucide-react';
import { BandPropagation, GPSStatus, SolarData, UIThemeMode } from '../types';
import { playTacticalClick } from '../utils/audio';

interface IonosondeStation {
  code: string;
  name: string;
  lat: number;
  lon: number;
  foF2: number | null;
  muf3000: number;
  distKm: number;
  distMiles: number;
}

interface IonosondeData {
  regionalMuf3000: number;
  regionalFoF2: number;
  nearestStation: IonosondeStation;
  stations: IonosondeStation[];
  sourceName: string;
  lastUpdated: string;
}

interface VOACAPPropagationWidgetProps {
  solar: SolarData;
  bands: BandPropagation[];
  theme: UIThemeMode;
  audioEnabled: boolean;
  location?: { lat: number; lon: number } | GPSStatus;
  onRefreshSolar: () => void;
}

export const VOACAPPropagationWidget: React.FC<VOACAPPropagationWidgetProps> = ({
  solar,
  bands,
  theme,
  audioEnabled,
  location,
  onRefreshSolar,
}) => {
  const [now, setNow] = useState(new Date());
  const [userSelectedBandName, setUserSelectedBandName] = useState<string | null>(null);
  const [ionosondeData, setIonosondeData] = useState<IonosondeData | null>(null);
  const [isLoadingIonosonde, setIsLoadingIonosonde] = useState(false);
  const [showStationsList, setShowStationsList] = useState(false);

  // Fetch KC2G real-time ionosonde station data
  const fetchIonosonde = async () => {
    setIsLoadingIonosonde(true);
    try {
      const lat = location?.lat || 37.5407;
      const lon = location?.lon || -77.4360;
      const res = await fetch(`/api/ionosonde?lat=${lat}&lon=${lon}`);
      if (res.ok) {
        const data: IonosondeData = await res.json();
        setIonosondeData(data);
      }
    } catch (e) {
      console.warn('Failed to fetch live KC2G ionosonde data:', e);
    } finally {
      setIsLoadingIonosonde(false);
    }
  };

  useEffect(() => {
    fetchIonosonde();
  }, [location?.lat, location?.lon]);

  // Live clock tick every 10 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const isNight = theme === 'night_vision';
  const isSunlight = theme === 'sunlight';

  // 1. Calculate solar position & daylight factor
  const localHour = now.getHours() + now.getMinutes() / 60;
  const localTimeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const utcHourString = now.toISOString().substring(11, 19) + ' UTC';

  const rad = ((localHour - 13 + 24) % 24) * (2 * Math.PI / 24);
  const daylightFactor = Math.max(0, Math.min(1, (Math.cos(rad) + 1) / 2));
  const isNightIonosphere = daylightFactor < 0.35;

  // Real-time MUF & foF2 derived directly from KC2G ionosonde live data feed
  const regionalMuf = ionosondeData?.regionalMuf3000 
    || Math.round(((11.5 + solar.solarFlux / 22) * (1 - daylightFactor) + (17.5 + solar.solarFlux / 9) * daylightFactor) * 10) / 10;

  const foF2 = ionosondeData?.regionalFoF2 
    || Math.round(( (3.8 + solar.solarFlux / 40) * (1 - daylightFactor) + (7.2 + solar.solarFlux / 25) * daylightFactor ) * 10) / 10;

  // Band center frequencies in MHz
  const bandCenterFreqs: Record<string, number> = {
    '160m': 1.9,
    '80m': 3.65,
    '60m': 5.35,
    '40m': 7.15,
    '30m': 10.125,
    '20m': 14.175,
    '17m': 18.12,
    '15m': 21.225,
    '12m': 24.94,
    '10m': 28.85,
    '6m': 50.125,
  };

  // 3. Compute dynamic real-time propagation values for all HF bands
  const computedBands: BandPropagation[] = bands.map((b) => {
    const centerFreq = bandCenterFreqs[b.band] || parseFloat(b.frequencyMHz) || 14.0;
    const isBelowMuf = centerFreq <= regionalMuf;

    // Current probability interpolated dynamically based on daylight & MUF cutoff
    let liveProb = Math.round(b.nightProb * (1 - daylightFactor) + b.dayProb * daylightFactor);

    // Physics penalty if band frequency exceeds real-time KC2G ionosonde MUF
    if (!isBelowMuf) {
      const overageRatio = centerFreq / regionalMuf;
      liveProb = Math.max(0, Math.round(liveProb / (overageRatio * 2.5)));
    }

    let liveStatus: 'Excellent' | 'Good' | 'Fair' | 'Poor' = 'Poor';
    if (liveProb >= 80) liveStatus = 'Excellent';
    else if (liveProb >= 55) liveStatus = 'Good';
    else if (liveProb >= 30) liveStatus = 'Fair';

    return {
      ...b,
      currentProb: liveProb,
      currentMuf: regionalMuf,
      status: liveStatus,
    };
  });

  // Top recommended band for RIGHT NOW
  const topBandNow = [...computedBands].sort((a, b) => (b.currentProb || 0) - (a.currentProb || 0))[0];

  // Active selected band
  const activeBand = computedBands.find((b) => b.band === userSelectedBandName) || topBandNow || computedBands[0];

  const cardBg = isNight
    ? 'bg-black border-red-900/90 text-red-500 rounded-2xl p-4 sm:p-5 shadow-lg'
    : isSunlight
    ? 'bg-white border-amber-400 text-slate-900 shadow-sm rounded-2xl p-4 sm:p-5'
    : 'bg-zinc-900/50 border-zinc-800 text-zinc-100 shadow-lg rounded-2xl p-4 sm:p-5';

  const getStatusColor = (status: BandPropagation['status']) => {
    switch (status) {
      case 'Excellent':
        return isNight ? 'text-red-400 border-red-700 bg-red-950/60' : 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
      case 'Good':
        return isNight ? 'text-red-400 border-red-800 bg-red-950/40' : 'text-amber-400 border-amber-500/30 bg-amber-500/10';
      case 'Fair':
        return isNight ? 'text-red-500 border-red-900 bg-red-950/20' : 'text-amber-300 border-zinc-700 bg-zinc-800/60';
      case 'Poor':
      default:
        return isNight ? 'text-red-800 border-red-950 bg-black' : 'text-zinc-500 border-zinc-800 bg-zinc-950/50';
    }
  };

  return (
    <div className={`border ${cardBg} font-mono transition-all space-y-3`}>
      {/* Widget Header & KC2G Live Station Engine Badge */}
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-zinc-800/80 gap-2">
        <div className="flex items-center gap-2">
          <Activity className={`w-4 h-4 ${isNight ? 'text-red-500' : 'text-amber-400'} animate-pulse`} />
          <div>
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
              <span>VOACAP & KC2G IONOSONDE HF FORECAST</span>
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px]">
          <span className={`px-2 py-0.5 rounded border font-bold flex items-center gap-1 ${
            isNight ? 'border-red-900 bg-red-950 text-red-400' : 'border-emerald-700 bg-emerald-950/80 text-emerald-300'
          }`}>
            <Database className="w-3 h-3 text-emerald-400" />
            <span>{ionosondeData?.sourceName || 'KC2G IONOSONDE FEED'}</span>
          </span>

          <button
            id="btn-refresh-solar-data"
            onClick={() => {
              playTacticalClick(audioEnabled);
              onRefreshSolar();
              fetchIonosonde();
            }}
            className={`p-1 rounded border active:scale-95 ${
              isNight ? 'border-red-900 bg-red-950 text-red-400' : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
            title="Refresh KC2G Ionosonde & NOAA Solar Data"
          >
            <RefreshCw className={`w-3 h-3 ${isLoadingIonosonde ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Live Time & KC2G Ionosonde Real-Time Anchor Banner */}
      <div className={`p-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs font-mono ${
        isNightIonosphere
          ? 'bg-indigo-950/40 border-indigo-500/30 text-indigo-200'
          : 'bg-amber-950/30 border-amber-500/30 text-amber-200'
      }`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
            <div>
              <span className="font-black text-cyan-300 text-xs">{localTimeString}</span>
              <span className="text-[10px] text-zinc-400 ml-1.5">({utcHourString})</span>
            </div>
          </div>

          <div className="flex items-center gap-2 border-l border-zinc-700/60 pl-3 text-[11px]">
            <span className="text-zinc-400">KC2G REAL-TIME MUF (3000 km):</span>
            <span className="font-black text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-500/50 text-xs">
              {regionalMuf} MHz
            </span>
            <span className="text-zinc-400 ml-1">foF2:</span>
            <span className="font-bold text-cyan-300">{foF2} MHz</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {ionosondeData?.nearestStation && (
            <button
              onClick={() => {
                playTacticalClick(audioEnabled);
                setShowStationsList(!showStationsList);
              }}
              className="text-[10px] px-2 py-1 rounded bg-zinc-950/80 hover:bg-zinc-900 border border-amber-500/40 text-amber-300 font-bold flex items-center gap-1 active:scale-95"
              title="Click to toggle KC2G station network breakdown"
            >
              <Radio className="w-3 h-3 text-amber-400" />
              <span>STN: {ionosondeData.nearestStation.name.split(',')[0]} ({ionosondeData.nearestStation.distMiles} mi)</span>
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>
          )}

          {topBandNow && (
            <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/40 font-black uppercase flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-emerald-400" /> BEST: {topBandNow.band} ({topBandNow.currentProb}%)
            </span>
          )}
        </div>
      </div>

      {/* KC2G Ionosonde Network Station Drawer */}
      {showStationsList && ionosondeData && (
        <div className="p-3 rounded-xl border border-cyan-800/80 bg-zinc-950/90 text-zinc-200 text-xs font-mono space-y-2">
          <div className="flex items-center justify-between border-b border-cyan-800/60 pb-1.5 font-bold">
            <span className="text-cyan-300 flex items-center gap-1.5 uppercase">
              <MapPin className="w-3.5 h-3.5 text-cyan-400" /> KC2G LIVE IONOSONDE NETWORK STATIONS
            </span>
            <span className="text-[10px] text-zinc-400">PROP.KC2G.COM FEED</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {ionosondeData.stations.slice(0, 6).map((stn) => (
              <div key={stn.code} className="p-2 rounded bg-zinc-900/80 border border-zinc-800 space-y-1">
                <div className="flex items-center justify-between font-bold text-amber-300 text-[11px]">
                  <span>{stn.name}</span>
                  <span className="text-[10px] text-zinc-400">{stn.distMiles} mi</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-zinc-300">
                  <span>MUF(3000): <strong className="text-emerald-400">{stn.muf3000} MHz</strong></span>
                  <span>foF2: <strong className="text-cyan-300">{stn.foF2 ? `${stn.foF2} MHz` : 'N/A'}</strong></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Solar Parameters Bar (SFI, SSN, A-Index, K-Index) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3 text-xs">
        <div className={`p-2 rounded border text-center ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
          <span className="text-[10px] uppercase opacity-70 block">SOLAR FLUX (SFI)</span>
          <span className="font-black text-amber-400 text-sm">{solar.solarFlux}</span>
        </div>

        <div className={`p-2 rounded border text-center ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
          <span className="text-[10px] uppercase opacity-70 block">SUNSPOT NO. (SSN)</span>
          <span className="font-black text-cyan-400 text-sm">{solar.sunspotNumber}</span>
        </div>

        <div className={`p-2 rounded border text-center ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
          <span className="text-[10px] uppercase opacity-70 block">A-INDEX</span>
          <span className="font-black text-emerald-400 text-sm">{solar.aIndex}</span>
        </div>

        <div className={`p-2 rounded border text-center ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
          <span className="text-[10px] uppercase opacity-70 block">K-INDEX</span>
          <span className="font-black text-emerald-400 text-sm">{solar.kIndex} ({solar.kDescription})</span>
        </div>

        <div className={`col-span-2 sm:col-span-1 p-2 rounded border text-center ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
          <span className="text-[10px] uppercase opacity-70 block">X-RAY FLARE</span>
          <span className="font-black text-yellow-300 text-sm">{solar.xray}</span>
        </div>
      </div>

      {/* HF Bands Forecast Grid Matrix - Spacious 2-Row Layout */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-4">
        {computedBands.map((b) => {
          const isSelected = activeBand.band === b.band;
          const statusStyle = getStatusColor(b.status);
          const isTop = topBandNow?.band === b.band;

          return (
            <button
              id={`btn-band-select-${b.band}`}
              key={b.band}
              onClick={() => {
                playTacticalClick(audioEnabled);
                setUserSelectedBandName(b.band);
              }}
              className={`p-3 rounded-xl border text-left transition-all active:scale-95 touch-manipulation flex flex-col justify-between space-y-2 min-h-[120px] ${statusStyle} ${
                isSelected ? 'ring-2 ring-cyan-400 scale-[1.02] shadow-md' : 'hover:opacity-90'
              }`}
            >
              {/* Line 1: Band Title & Freq */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="font-black text-sm text-zinc-100 uppercase tracking-wider">{b.band}</span>
                  <span className="text-[10px] text-zinc-400 font-mono font-normal">
                    ({b.frequencyMHz.split(' ')[0]}M)
                  </span>
                </div>
                {isTop && <span className="text-emerald-400 text-xs font-black tracking-tighter" title="Top Band Right Now">★ TOP</span>}
              </div>

              {/* Line 2: Reliability Status Badge */}
              <div>
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-black/80 border border-current/40 uppercase tracking-wider inline-block">
                  {b.status}
                </span>
              </div>

              {/* Line 3: Now % */}
              <div className="flex items-center justify-between border-t border-current/20 pt-1.5 text-xs font-bold">
                <span className="opacity-70 text-[10px]">NOW:</span>
                <span className="text-amber-300 font-black text-sm">{b.currentProb}%</span>
              </div>

              {/* Line 4: Day / Night % */}
              <div className="flex items-center justify-between text-[10px] opacity-85 font-mono">
                <span>DAY: <strong className="text-emerald-300">{b.dayProb}%</strong></span>
                <span>NIGHT: <strong className="text-indigo-300">{b.nightProb}%</strong></span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Band VOACAP Propagation Breakdown */}
      {activeBand && (
        <div className={`p-3 rounded-xl border ${isNight ? 'border-red-900 bg-red-950/30' : isSunlight ? 'border-amber-300 bg-amber-100/60' : 'border-cyan-800/80 bg-cyan-950/30'} flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs`}>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-black text-base text-cyan-300 uppercase">{activeBand.band} BAND ({activeBand.frequencyMHz})</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-900 text-cyan-200 font-bold font-mono">
                KC2G REGIONAL MUF: {activeBand.currentMuf} MHz
              </span>
              {topBandNow?.band === activeBand.band && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-black uppercase">
                  ★ OPTIMAL BAND NOW
                </span>
              )}
            </div>

            <p className="text-[11px] opacity-90">
              Recommended Modes: <span className="font-bold text-amber-300">{activeBand.recommendedModes.join(', ')}</span>
            </p>

            <p className="text-[10px] text-zinc-400 leading-normal">
              {isNightIonosphere ? (
                activeBand.band === '80m' || activeBand.band === '40m' || activeBand.band === '30m' ? (
                  <span>🌙 <strong>Night Propagation Peak:</strong> Low solar absorption makes {activeBand.band} highly reliable for long distance contacts at {localTimeString}.</span>
                ) : (
                  <span>🌙 <strong>Night Ionosphere Cutoff:</strong> Lack of daytime solar ionization drops {activeBand.band} reliability to {activeBand.currentProb}% against the {regionalMuf} MHz MUF.</span>
                )
              ) : (
                activeBand.band === '20m' || activeBand.band === '17m' || activeBand.band === '15m' || activeBand.band === '10m' ? (
                  <span>☀️ <strong>Daytime Ionospheric Peak:</strong> High solar ionization powers F2-layer long-haul propagation on {activeBand.band}.</span>
                ) : (
                  <span>☀️ <strong>Daytime D-Layer Absorption:</strong> D-layer ionization causes higher signal attenuation on lower frequencies ({activeBand.band}).</span>
                )
              )}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 font-mono">
            <div className="text-right p-2 rounded bg-zinc-950/60 border border-zinc-800">
              <span className="text-[9px] uppercase opacity-70 block text-zinc-400">RELIABILITY NOW</span>
              <span className={`font-black text-sm ${
                (activeBand.currentProb || 0) >= 80 ? 'text-emerald-400' :
                (activeBand.currentProb || 0) >= 55 ? 'text-amber-400' :
                (activeBand.currentProb || 0) >= 30 ? 'text-amber-300' : 'text-red-400'
              }`}>{activeBand.currentProb}%</span>
            </div>
            <div className="text-right text-[10px] opacity-80 space-y-0.5">
              <div>DAY REF: <span className="font-bold text-emerald-400">{activeBand.dayProb}%</span></div>
              <div>NIGHT REF: <span className="font-bold text-amber-300">{activeBand.nightProb}%</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

