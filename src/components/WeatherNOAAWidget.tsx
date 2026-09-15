import React, { useState, useEffect, useRef } from 'react';
import { CloudRain, Sun, Wind, Thermometer, AlertOctagon, ChevronDown, ChevronUp, ShieldAlert, Volume2, VolumeX, Check, Clock } from 'lucide-react';
import { ExternalDataStatus, NOAAAlert, UIThemeMode, WeatherData } from '../types';
import { playTacticalClick, playEmergencyBeep, speakNOAAAlert, speakNOAAAlertFull, cancelSpeech } from '../utils/audio';
import { formatWeatherHour, resolveOperatorTimeZone, weatherConditionLabel } from '../utils/weatherTime';

interface WeatherNOAAWidgetProps {
  weather: WeatherData | null;
  alerts: NOAAAlert[] | null;
  weatherStatus: ExternalDataStatus;
  alertsStatus: ExternalDataStatus;
  theme: UIThemeMode;
  audioEnabled: boolean;
}

export const WeatherNOAAWidget: React.FC<WeatherNOAAWidgetProps> = ({
  weather,
  alerts,
  weatherStatus,
  alertsStatus,
  theme,
  audioEnabled,
}) => {
  const alertItems = alerts ?? [];
  const effectiveAlertsStatus = alertsStatus === 'live' && alerts === null ? 'unavailable' : alertsStatus;
  const [showAlertsDrawer, setShowAlertsDrawer] = useState(false);
  const [isAcknowledged, setIsAcknowledged] = useState(false);
  const announcedAlertIds = useRef<Set<string>>(new Set());

  // Check persisted acknowledged alert IDs from localStorage
  useEffect(() => {
    try {
      const savedAckJson = localStorage.getItem('fieldops_ack_alerts');
      const ackIds: string[] = savedAckJson ? JSON.parse(savedAckJson) : [];
      
      const currentIds = alertItems.map(a => a.id);
      const allAck = currentIds.length > 0 && currentIds.every(id => ackIds.includes(id));
      
      if (allAck) {
        setIsAcknowledged(true);
      } else if (alertItems.length > 0) {
        setIsAcknowledged(false);
        // Only announce if there is a NEW unacknowledged alert
        const unackAlert = alertItems.find(a => !ackIds.includes(a.id) && !announcedAlertIds.current.has(a.id));
        if (unackAlert) {
          announcedAlertIds.current.add(unackAlert.id);
          speakNOAAAlert(unackAlert.title, unackAlert.area, audioEnabled);
        }
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [alerts, audioEnabled]);

  const handleAcknowledge = () => {
    cancelSpeech();
    setIsAcknowledged(true);
    playTacticalClick(audioEnabled);
    try {
      const currentIds = alertItems.map(a => a.id);
      localStorage.setItem('fieldops_ack_alerts', JSON.stringify(currentIds));
    } catch (e) {
      // Ignore localStorage write error
    }
  };

  const handleTestVoiceAlert = (full = false) => {
    playTacticalClick(audioEnabled);
    setIsAcknowledged(false);
    if (alertItems.length > 0) {
      const first = alertItems[0];
      if (full) {
        speakNOAAAlertFull(first.title, first.description, true);
      } else {
        speakNOAAAlert(first.title, first.area, true);
      }
    }
  };

  const alertBadgeBg = alertItems.length > 0
    ? 'fo-status-caution font-bold'
    : 'fo-status-neutral';

  const weatherStatusLabel = weatherStatus === 'live'
    ? 'LIVE'
    : weatherStatus === 'loading'
    ? 'REFRESHING'
    : 'LAST KNOWN / UPDATE UNAVAILABLE';
  const weatherStatusClass = weatherStatus === 'live'
    ? 'fo-status-success'
    : weatherStatus === 'loading'
    ? 'fo-status-info'
    : 'fo-status-caution';

  const hourlyList = weather?.hourlyForecast?.slice(0, 6) ?? [];
  const operatorTimeZone = resolveOperatorTimeZone();

  return (
    <div data-theme={theme} className="fo-surface border rounded-2xl p-4 sm:p-5 font-mono transition-all space-y-3">
      {/* Header & NOAA Badge */}
      <div className="flex items-center justify-between pb-3 border-b border-[var(--fo-border-subtle)]">
        <div className="flex items-center gap-2">
          <CloudRain className="fo-icon-info w-4 h-4" />
          <h3 className="fo-text-secondary text-xs font-bold uppercase tracking-widest">
            FIELD WEATHER SNAPSHOT & NOAA ALERTS
          </h3>
          {weather && (
            <span
              data-testid="weather-freshness-status"
              className={`px-1.5 py-0.5 rounded border text-[9px] font-black tracking-wider ${weatherStatusClass}`}
            >
              {weatherStatusLabel}
            </span>
          )}
        </div>

        {/* NOAA Alert Controls */}
        <div className="flex items-center gap-2">
          {alertItems.length > 0 && (
            <button
              id="btn-acknowledge-noaa-alert"
              onClick={handleAcknowledge}
              className={`min-h-11 px-2.5 py-1 rounded-md border text-[11px] font-bold flex items-center gap-1.5 transition-all active:scale-95 ${
                isAcknowledged
                  ? 'fo-status-neutral'
                  : 'fo-status-caution animate-pulse motion-reduce:animate-none'
              }`}
              title="Stop voice broadcast and mark alert acknowledged"
              aria-pressed={isAcknowledged}
            >
              {isAcknowledged ? (
                <>
                  <Check className="fo-icon-success w-3.5 h-3.5" />
                  <span>ACKNOWLEDGED</span>
                </>
              ) : (
                <>
                  <VolumeX className="fo-icon-caution w-3.5 h-3.5" />
                  <span>ACK / SILENCE VOICE</span>
                </>
              )}
            </button>
          )}

          <button
            id="btn-toggle-noaa-alerts"
            onClick={() => {
              playTacticalClick(audioEnabled);
              if (!showAlertsDrawer && alertItems.length > 0) {
                playEmergencyBeep(audioEnabled);
              }
              setShowAlertsDrawer(!showAlertsDrawer);
            }}
            className={`min-h-11 px-2 py-1 rounded border text-[11px] font-bold flex items-center gap-1.5 transition-all active:scale-95 ${alertBadgeBg}`}
            aria-expanded={showAlertsDrawer}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{effectiveAlertsStatus === 'loading'
              ? 'CHECKING NOAA'
              : effectiveAlertsStatus === 'unavailable'
                ? 'NOAA UNAVAILABLE'
                : `NOAA ALERTS (${alertItems.length})`}</span>
            {showAlertsDrawer ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {weather ? (
      <>
      {/* Main Weather Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
        
        {/* Temperature & Condition */}
        <div className="fo-surface-subtle p-2 rounded-lg border">
          <div className="flex items-center justify-between text-[10px] text-current/70 mb-0.5">
            <span>TEMP / CONDITION</span>
            <Thermometer className="fo-icon-neutral w-3.5 h-3.5" />
          </div>
          <div className="fo-text-primary font-black text-base">
            {weather.tempF}°F ({weather.tempC}°C)
          </div>
          <span className="text-[10px] opacity-80">{weather.condition}</span>
        </div>

        {/* Barometric Pressure */}
        <div className="fo-surface-subtle p-2 rounded-lg border">
          <div className="flex items-center justify-between text-[10px] text-current/70 mb-0.5">
            <span>BARO PRESSURE</span>
            <span className="fo-text-muted font-bold">inHg</span>
          </div>
          <div className="fo-text-primary font-black text-base">
            {weather.pressureInHg} inHg
          </div>
          <span className="text-[10px] opacity-80">{weather.pressureHpa} hPa (SURFACE)</span>
        </div>

        {/* Wind Speed & Direction */}
        <div className="fo-surface-subtle p-2 rounded-lg border">
          <div className="flex items-center justify-between text-[10px] text-current/70 mb-0.5">
            <span>WIND / MAST RISK</span>
            <Wind className="fo-icon-neutral w-3.5 h-3.5" />
          </div>
          <div className="fo-text-primary font-black text-base">
            {weather.windMph} MPH {weather.windDir}
          </div>
          <span className="text-[10px] opacity-80">
            {weather.windGustMph === undefined ? 'GUST DATA UNAVAILABLE' : `GUSTS TO ${weather.windGustMph} MPH`}
          </span>
        </div>

        {/* Humidity & Dew Point */}
        <div className="fo-surface-subtle p-2 rounded-lg border">
          <div className="flex items-center justify-between text-[10px] text-current/70 mb-0.5">
            <span>HUMIDITY / DEW</span>
            <Sun className="fo-icon-neutral w-3.5 h-3.5" />
          </div>
          <div className="font-black text-base">
            {weather.humidity}%
          </div>
          <span className="text-[10px] opacity-80">DEW POINT {weather.dewPointF}°F</span>
        </div>

      </div>

      {/* 6-Hour Tactical Operational Forecast Row */}
      <div className="fo-surface-subtle p-2.5 rounded-xl border space-y-1.5">
        <div className="fo-text-secondary flex items-center justify-between text-[10px] uppercase font-bold">
          <span className="fo-text-info flex items-center gap-1.5">
            <Clock className="fo-icon-info w-3 h-3" /> 6-HOUR OPERATIONAL WEATHER OUTLOOK
          </span>
          <span className="fo-text-muted font-mono">TIME ZONE: {operatorTimeZone}</span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {hourlyList.map((item, idx) => (
            <div key={idx} className="fo-surface-raised p-1.5 rounded-lg border text-center space-y-0.5">
              <span className="fo-text-info text-[10px] font-extrabold block">{formatWeatherHour(item.utcTime ?? item.time, operatorTimeZone)}</span>
              <span className="fo-text-secondary text-[9px] font-bold leading-tight block" title={weatherConditionLabel(item.weatherCode)}>{weatherConditionLabel(item.weatherCode)}</span>
              <span className="fo-text-primary text-xs font-black block">{item.tempF}°F</span>
              <div className="fo-text-muted flex items-center justify-center gap-1 text-[9px]">
                <span>{item.windMph}mph</span>
                <span className="fo-text-info font-bold" aria-label={`Precipitation ${item.precipProb}%`}>💧{item.precipProb}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      </>
      ) : (
        <div className="fo-surface-subtle min-h-36 rounded-xl border flex items-center justify-center text-center p-5">
          <div>
            <span className="block text-base font-black">—</span>
            <span className="fo-text-secondary block text-xs font-bold uppercase">
              {weatherStatus === 'loading' ? 'Loading field weather' : 'Weather unavailable'}
            </span>
            <span className="fo-text-muted block text-[10px] mt-1">No fallback conditions are being displayed.</span>
          </div>
        </div>
      )}

      {/* NOAA Alert Details Drawer */}
      {showAlertsDrawer && (
        <div className="fo-status-caution mt-3 p-3 rounded-xl border space-y-3 text-xs font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 font-bold border-b border-current/30 pb-2">
            <span className="flex items-center gap-1.5 uppercase font-black">
              <AlertOctagon className="w-4 h-4" /> NOAA WEATHER MONITORING ({weather?.locationName ?? (effectiveAlertsStatus === 'unavailable' ? 'LOCATION UNAVAILABLE' : 'SELECTED OPERATING LOCATION')})
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleAcknowledge}
                disabled={effectiveAlertsStatus !== 'live' || alertItems.length === 0}
                className="fo-control min-h-11 px-2 py-1 rounded border font-mono font-bold text-[10px] flex items-center gap-1 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                title={alertItems.length > 0 ? 'Silence active text-to-speech reading' : 'No active alert is available to acknowledge'}
              >
                <VolumeX className="w-3 h-3" />
                <span>SILENCE / ACK</span>
              </button>
              <button
                onClick={() => handleTestVoiceAlert(false)}
                disabled={effectiveAlertsStatus !== 'live' || alertItems.length === 0}
                className="fo-control min-h-11 px-2 py-1 rounded border font-mono font-bold text-[10px] flex items-center gap-1 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                title={alertItems.length > 0 ? 'Speak concise alert title and area' : 'No active alert is available to speak'}
              >
                <Volume2 className="w-3 h-3" />
                <span>SPEAK TYPE ONLY</span>
              </button>
            </div>
          </div>

          {effectiveAlertsStatus === 'unavailable' ? (
            <div className="fo-status-neutral p-3 rounded-lg border text-xs font-mono">
              <span className="font-black block">NOAA ALERT STATUS UNAVAILABLE</span>
              <span className="text-[10px]">The dashboard could not confirm whether active alerts exist.</span>
            </div>
          ) : effectiveAlertsStatus === 'loading' ? (
            <div className="fo-status-info p-3 rounded-lg border text-xs font-mono">
              Checking NOAA alerts for the selected operating location…
            </div>
          ) : alertItems.length === 0 ? (
            <div className="fo-status-success p-3 rounded-lg border text-xs font-mono flex items-center justify-between">
              <div>
                <span className="font-black block">✅ ALL CLEAR — NO ACTIVE NOAA WEATHER ADVISORIES</span>
                <span className="text-[10px] opacity-80">Location: {weather?.locationName ?? 'Selected operating location'} • Direct NWS point API scan clear.</span>
              </div>
            </div>
          ) : (
            alertItems.map((alt) => (
              <div key={alt.id} className="fo-surface-subtle space-y-1.5 p-2.5 rounded-lg border">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="fo-text-caution font-black text-xs flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span>{alt.title} — {alt.area}</span>
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => speakNOAAAlert(alt.title, alt.area, true)}
                      className="fo-text-caution text-[10px] font-bold flex items-center gap-1 underline"
                      title="Speak type and location only"
                    >
                      <Volume2 className="w-3 h-3" /> Speak Type
                    </button>
                    <button
                      onClick={() => speakNOAAAlertFull(alt.title, alt.description, true)}
                      className="fo-text-caution text-[10px] font-bold flex items-center gap-1 underline opacity-90"
                      title="Read full warning text"
                    >
                      Read Full
                    </button>
                  </div>
                </div>
                <p className="fo-text-secondary text-[11px] leading-relaxed font-sans">{alt.description}</p>
                <div className="fo-text-caution text-[10px] flex items-center justify-between pt-1 font-mono border-t border-current/20 opacity-90">
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
