import React, { useState, useEffect } from 'react';
import { CloudRain, Sun, Wind, Thermometer, AlertOctagon, ChevronDown, ChevronUp, ShieldAlert, Volume2, VolumeX, Check } from 'lucide-react';
import { NOAAAlert, UIThemeMode, WeatherData } from '../types';
import { playTacticalClick, playEmergencyBeep, speakNOAAAlert, speakNOAAAlertFull, cancelSpeech } from '../utils/audio';

interface WeatherNOAAWidgetProps {
  weather: WeatherData;
  alerts: NOAAAlert[];
  theme: UIThemeMode;
  audioEnabled: boolean;
}

export const WeatherNOAAWidget: React.FC<WeatherNOAAWidgetProps> = ({
  weather,
  alerts,
  theme,
  audioEnabled,
}) => {
  const [showAlertsDrawer, setShowAlertsDrawer] = useState(false);
  const [lastAlertCount, setLastAlertCount] = useState(alerts.length);
  const [isAcknowledged, setIsAcknowledged] = useState(false);

  // Trigger concise speech alert if new alert arrives
  useEffect(() => {
    if (alerts.length > lastAlertCount && alerts.length > 0) {
      const first = alerts[0];
      setIsAcknowledged(false);
      // Announce ONLY alert type + area by default (concise mode)
      speakNOAAAlert(first.title, first.area, audioEnabled);
    }
    setLastAlertCount(alerts.length);
  }, [alerts, audioEnabled]);

  const handleAcknowledge = () => {
    cancelSpeech();
    setIsAcknowledged(true);
    playTacticalClick(audioEnabled);
  };

  const handleTestVoiceAlert = (full = false) => {
    playTacticalClick(audioEnabled);
    setIsAcknowledged(false);
    if (alerts.length > 0) {
      const first = alerts[0];
      if (full) {
        speakNOAAAlertFull(first.title, first.description, true);
      } else {
        speakNOAAAlert(first.title, first.area, true);
      }
    } else {
      speakNOAAAlert('Test Weather Advisory', 'Richmond, VA', true);
    }
  };

  const isNight = theme === 'night_vision';
  const isSunlight = theme === 'sunlight';

  const cardBg = isNight
    ? 'bg-black border-red-900/90 text-red-500 rounded-2xl p-4 sm:p-5 shadow-lg'
    : isSunlight
    ? 'bg-white border-amber-400 text-slate-900 shadow-sm rounded-2xl p-4 sm:p-5'
    : 'bg-zinc-900/50 border-zinc-800 text-zinc-100 shadow-lg rounded-2xl p-4 sm:p-5';

  const alertBadgeBg = alerts.length > 0
    ? isNight
      ? 'border-red-600 bg-red-950 text-red-400'
      : 'border-amber-500/40 bg-amber-500/10 text-amber-400 font-bold'
    : isNight
    ? 'border-red-950 text-red-800'
    : 'border-zinc-800 bg-zinc-800/60 text-zinc-400';

  return (
    <div className={`border ${cardBg} font-mono transition-all space-y-3`}>
      {/* Header & NOAA Badge */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
        <div className="flex items-center gap-2">
          <CloudRain className={`w-4 h-4 ${isNight ? 'text-red-500' : 'text-sky-400'}`} />
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
            FIELD WEATHER SNAPSHOT & NOAA ALERTS
          </h3>
        </div>

        {/* NOAA Alert Controls */}
        <div className="flex items-center gap-2">
          {alerts.length > 0 && (
            <button
              id="btn-acknowledge-noaa-alert"
              onClick={handleAcknowledge}
              className={`px-2.5 py-1 rounded-md border text-[11px] font-bold flex items-center gap-1.5 transition-all active:scale-95 ${
                isAcknowledged
                  ? 'bg-zinc-800/80 border-zinc-700 text-zinc-400'
                  : 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/60 text-amber-300 animate-pulse'
              }`}
              title="Stop voice broadcast and mark alert acknowledged"
            >
              {isAcknowledged ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>ACKNOWLEDGED</span>
                </>
              ) : (
                <>
                  <VolumeX className="w-3.5 h-3.5 text-amber-400" />
                  <span>ACK / SILENCE VOICE</span>
                </>
              )}
            </button>
          )}

          <button
            id="btn-toggle-noaa-alerts"
            onClick={() => {
              playTacticalClick(audioEnabled);
              if (!showAlertsDrawer && alerts.length > 0) {
                playEmergencyBeep(audioEnabled);
              }
              setShowAlertsDrawer(!showAlertsDrawer);
            }}
            className={`px-2 py-1 rounded border text-[11px] font-bold flex items-center gap-1.5 transition-all active:scale-95 ${alertBadgeBg}`}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            <span>NOAA ALERTS ({alerts.length})</span>
            {showAlertsDrawer ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Main Weather Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
        
        {/* Temperature & Condition */}
        <div className={`p-2 rounded-lg border ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
          <div className="flex items-center justify-between text-[10px] text-current/70 mb-0.5">
            <span>TEMP / CONDITION</span>
            <Thermometer className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="font-black text-base text-amber-300">
            {weather.tempF}°F ({weather.tempC}°C)
          </div>
          <span className="text-[10px] opacity-80">{weather.condition}</span>
        </div>

        {/* Barometric Pressure */}
        <div className={`p-2 rounded-lg border ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
          <div className="flex items-center justify-between text-[10px] text-current/70 mb-0.5">
            <span>BARO PRESSURE</span>
            <span className="text-cyan-400 font-bold">inHg</span>
          </div>
          <div className="font-black text-base text-cyan-300">
            {weather.pressureInHg} inHg
          </div>
          <span className="text-[10px] opacity-80">{weather.pressureHpa} hPa (STEADY)</span>
        </div>

        {/* Wind Speed & Direction */}
        <div className={`p-2 rounded-lg border ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
          <div className="flex items-center justify-between text-[10px] text-current/70 mb-0.5">
            <span>WIND / MAST RISK</span>
            <Wind className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="font-black text-base text-emerald-400">
            {weather.windMph} MPH {weather.windDir}
          </div>
          <span className="text-[10px] opacity-80">GUSTS TO {weather.windGustMph || 12} MPH</span>
        </div>

        {/* Humidity & Dew Point */}
        <div className={`p-2 rounded-lg border ${isNight ? 'border-red-950 bg-black' : isSunlight ? 'border-slate-300 bg-amber-50' : 'border-slate-800 bg-slate-950/60'}`}>
          <div className="flex items-center justify-between text-[10px] text-current/70 mb-0.5">
            <span>HUMIDITY / DEW</span>
            <Sun className="w-3.5 h-3.5 text-yellow-400" />
          </div>
          <div className="font-black text-base">
            {weather.humidity}%
          </div>
          <span className="text-[10px] opacity-80">DEW POINT {weather.dewPointF}°F</span>
        </div>

      </div>

      {/* NOAA Alert Details Drawer */}
      {showAlertsDrawer && (
        <div className="mt-3 p-3 rounded-xl border border-amber-500/40 bg-amber-950/40 text-amber-200 space-y-3 text-xs font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 font-bold border-b border-amber-500/30 pb-2">
            <span className="flex items-center gap-1.5 text-amber-300 uppercase font-black">
              <AlertOctagon className="w-4 h-4 text-amber-400" /> NOAA WEATHER MONITORING ({weather.locationName})
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleAcknowledge}
                className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 font-mono font-bold text-[10px] flex items-center gap-1 active:scale-95"
                title="Silence active text-to-speech reading"
              >
                <VolumeX className="w-3 h-3 text-amber-400" />
                <span>SILENCE / ACK</span>
              </button>
              <button
                onClick={() => handleTestVoiceAlert(false)}
                className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-mono font-bold text-[10px] flex items-center gap-1 active:scale-95"
                title="Broadcast concise alert title & area only"
              >
                <Volume2 className="w-3 h-3 text-amber-400" />
                <span>SPEAK TYPE ONLY</span>
              </button>
            </div>
          </div>

          {alerts.length === 0 ? (
            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs font-mono flex items-center justify-between">
              <div>
                <span className="font-black text-emerald-400 block">✅ ALL CLEAR — NO ACTIVE NOAA WEATHER ADVISORIES</span>
                <span className="text-[10px] text-emerald-300/80">Location: {weather.locationName} • Direct NWS point API scan clear.</span>
              </div>
            </div>
          ) : (
            alerts.map((alt) => (
              <div key={alt.id} className="space-y-1.5 p-2.5 rounded-lg bg-zinc-950/60 border border-amber-500/30">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="font-black text-amber-300 text-xs flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>{alt.title} — {alt.area}</span>
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => speakNOAAAlert(alt.title, alt.area, true)}
                      className="text-[10px] font-bold text-amber-400 hover:text-amber-200 flex items-center gap-1 underline"
                      title="Speak type and location only"
                    >
                      <Volume2 className="w-3 h-3" /> Speak Type
                    </button>
                    <button
                      onClick={() => speakNOAAAlertFull(alt.title, alt.description, true)}
                      className="text-[10px] font-bold text-amber-400/80 hover:text-amber-200 flex items-center gap-1 underline"
                      title="Read full warning text"
                    >
                      Read Full
                    </button>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-300 font-sans">{alt.description}</p>
                <div className="text-[10px] text-amber-400/80 flex items-center justify-between pt-1 font-mono border-t border-amber-500/10">
                  <span>ISSUED: {alt.issued}</span>
                  <span>EXPIRES: {alt.expires}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
