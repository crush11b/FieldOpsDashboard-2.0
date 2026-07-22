import React, { useState } from 'react';
import { 
  Radio, 
  Binary, 
  MessageSquareCode, 
  Activity, 
  BookOpenCheck, 
  Award, 
  Database, 
  MapPin, 
  Mail, 
  Globe, 
  Sliders, 
  Tv, 
  Clock, 
  Terminal, 
  Search, 
  Star, 
  CheckCircle2, 
  XCircle, 
  Play, 
  Plus, 
  FolderCheck,
  Edit2,
  Trash2,
  ExternalLink,
  Layers,
  Sparkles,
  Zap
} from 'lucide-react';
import { AppCategory, AppLauncherItem, UIThemeMode } from '../types';
import { playLaunchAlert, playTacticalClick } from '../utils/audio';

interface AppLauncherGridProps {
  apps: AppLauncherItem[];
  theme: UIThemeMode;
  audioEnabled: boolean;
  gridColumns: 2 | 3 | 4 | 6;
  onLaunchApp: (app: AppLauncherItem) => void;
  onToggleFavorite: (appId: string) => void;
  onEditApp: (app: AppLauncherItem) => void;
  onAddNewApp: () => void;
  onOpenAutoInstaller?: () => void;
}

// Icon mapper for Ham Radio apps
const getAppIcon = (iconName: string, className = "w-5 h-5") => {
  switch (iconName) {
    case 'Radio': return <Radio className={className} />;
    case 'Binary': return <Binary className={className} />;
    case 'MessageSquareCode': return <MessageSquareCode className={className} />;
    case 'Activity': return <Activity className={className} />;
    case 'BookOpenCheck': return <BookOpenCheck className={className} />;
    case 'Award': return <Award className={className} />;
    case 'Database': return <Database className={className} />;
    case 'MapPin': return <MapPin className={className} />;
    case 'Mail': return <Mail className={className} />;
    case 'Globe': return <Globe className={className} />;
    case 'Globe2': return <Globe className={className} />;
    case 'Sliders': return <Sliders className={className} />;
    case 'Tv': return <Tv className={className} />;
    case 'Clock': return <Clock className={className} />;
    case 'Clock4': return <Clock className={className} />;
    case 'Terminal': return <Terminal className={className} />;
    case 'Map': return <MapPin className={className} />;
    case 'Cpu': return <Binary className={className} />;
    case 'Navigation': return <Globe className={className} />;
    case 'Compass': return <Globe className={className} />;
    case 'Mic': return <Radio className={className} />;
    case 'Headphones': return <Radio className={className} />;
    case 'LayoutGrid': return <Layers className={className} />;
    case 'Signal': return <Activity className={className} />;
    case 'Eye': return <ExternalLink className={className} />;
    case 'Search': return <Search className={className} />;
    case 'RadioReceiver': return <Radio className={className} />;
    case 'ShieldCheck': return <Sparkles className={className} />;
    case 'Bot': return <Sparkles className={className} />;
    default: return <Radio className={className} />;
  }
};

const CATEGORIES: { id: AppCategory | 'all' | 'favorites'; label: string }[] = [
  { id: 'all', label: 'ALL APPS' },
  { id: 'favorites', label: '⭐ FAVORITES' },
  { id: 'digital', label: 'DIGITAL MODES' },
  { id: 'aprs', label: 'APRS' },
  { id: 'satellite', label: 'SATELLITE OPS' },
  { id: 'network_voice', label: 'NETWORK VOICE' },
  { id: 'web_apps', label: 'WEB APPS' },
  { id: 'logging', label: 'LOGGING & POTA' },
  { id: 'mapping', label: 'MAPPING' },
  { id: 'radio_control', label: 'RADIO CAT' },
  { id: 'utilities', label: 'UTILITIES' },
];

export const AppLauncherGrid: React.FC<AppLauncherGridProps> = ({
  apps,
  theme,
  audioEnabled,
  gridColumns,
  onLaunchApp,
  onToggleFavorite,
  onEditApp,
  onAddNewApp,
  onOpenAutoInstaller,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [launchingApp, setLaunchingApp] = useState<AppLauncherItem | null>(null);

  const isNight = theme === 'night_vision';
  const isSunlight = theme === 'sunlight';

  // Filter apps by category and search query
  const filteredApps = apps.filter((app) => {
    const matchesCategory =
      selectedCategory === 'all'
        ? true
        : selectedCategory === 'favorites'
        ? app.favorite
        : app.category === selectedCategory;

    const matchesSearch =
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.executablePath.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesCategory && matchesSearch;
  });

  const handleLaunch = (app: AppLauncherItem) => {
    playLaunchAlert(audioEnabled);
    setLaunchingApp(app);
    onLaunchApp(app);
    setTimeout(() => {
      setLaunchingApp(null);
    }, 1800);
  };

  // Grid class based on chosen column config
  const gridColClass = 
    gridColumns === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : gridColumns === 3
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      : gridColumns === 4
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
      : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-6';

  return (
    <div className="space-y-4 font-mono">
      {/* Field Applications Catalog Toolbar Header */}
      <div className={`p-4 rounded-2xl border ${
        isNight ? 'bg-black border-red-900' : isSunlight ? 'bg-white border-amber-400' : 'bg-zinc-900/90 border-zinc-800'
      } shadow-xl space-y-3`}>
        
        {/* Top Title & Quick Stats Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-800/80">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl border ${
              isNight ? 'border-red-900 bg-red-950 text-red-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
            }`}>
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-sm text-zinc-100 tracking-wider uppercase flex items-center gap-2">
                <span>FIELD APPLICATIONS CATALOG</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300">
                  {apps.length} EXECUTABLES
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400 font-mono">
                Launch, organize, and monitor field HAM radio tools & digital mode suites
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-48 sm:w-60">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-500" />
              <input
                id="input-search-apps"
                type="text"
                placeholder="Search tools & apps..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full pl-8 pr-3 py-1.5 rounded-xl text-xs font-mono border focus:outline-none focus:ring-1 ${
                  isNight ? 'bg-black border-red-900 text-red-400 focus:ring-red-600' : 'bg-zinc-950 border-zinc-800 text-zinc-100 focus:ring-amber-500'
                }`}
              />
            </div>

            <button
              id="btn-auto-installer-suite"
              onClick={() => {
                playTacticalClick(audioEnabled);
                if (onOpenAutoInstaller) onOpenAutoInstaller();
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 active:scale-95 border shrink-0 transition-all shadow-md ${
                isNight 
                  ? 'border-red-700 bg-red-900 text-white hover:bg-red-800' 
                  : 'border-amber-400 bg-amber-500 text-black hover:bg-amber-400 font-extrabold'
              }`}
              title="Auto-detect local executables, generate Winget/APT 1-click installer scripts, and sync paths"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>⚡ AUTO-INSTALL & PATH SYNC</span>
            </button>

            <button
              id="btn-add-custom-app"
              onClick={() => {
                playTacticalClick(audioEnabled);
                onAddNewApp();
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-95 border shrink-0 ${
                isNight ? 'border-red-800 bg-red-950 text-red-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">ADD APP</span>
            </button>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {CATEGORIES.map((cat) => {
            const active = selectedCategory === cat.id;
            return (
              <button
                id={`btn-cat-${cat.id}`}
                key={cat.id}
                onClick={() => {
                  playTacticalClick(audioEnabled);
                  setSelectedCategory(cat.id);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all active:scale-95 touch-manipulation border ${
                  active
                    ? isNight 
                      ? 'bg-red-800 border-red-600 text-white shadow-md' 
                      : isSunlight 
                      ? 'bg-amber-400 border-amber-600 text-slate-950 shadow-md font-extrabold' 
                      : 'bg-amber-500 border-amber-400 text-black font-extrabold shadow-md'
                    : isNight 
                    ? 'border-red-950 bg-black text-red-700 hover:text-red-400' 
                    : 'border-zinc-800/80 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Filter Summary Footer */}
        <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono pt-1">
          <span>SHOWING {filteredApps.length} OF {apps.length} EXECUTABLES</span>
          <span className="text-emerald-400 font-semibold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> SYSTEM PATHS VERIFIED
          </span>
        </div>
      </div>

      {/* Main Apps Grid */}
      <div className={`grid ${gridColClass} gap-3`}>
        {filteredApps.map((app) => {
          return (
            <div
              key={app.id}
              className={`p-3.5 rounded-2xl border flex flex-col justify-between gap-3 transition-all relative group shadow-md ${
                isNight
                  ? 'bg-black border-red-900 hover:border-red-600 text-red-500'
                  : isSunlight
                  ? 'bg-white border-amber-400 hover:border-amber-600 text-slate-900'
                  : 'bg-zinc-900/90 hover:bg-zinc-900 border-zinc-800 hover:border-amber-500/60 text-zinc-100'
              }`}
            >
              {/* Top Row: Icon, Name, Category, Hotkey, Favorite */}
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className={`p-2 rounded-xl border shrink-0 ${
                      isNight ? 'border-red-800 bg-red-950 text-red-400' : 'border-amber-500/20 bg-amber-500/10 text-amber-400'
                    }`}>
                      {getAppIcon(app.iconName, "w-4 h-4")}
                    </div>
                    <div>
                      <h4 className="font-black text-sm tracking-wide leading-tight text-zinc-100 line-clamp-1">{app.name}</h4>
                      <span className="text-[10px] uppercase font-bold text-zinc-400">
                        {app.category.replace('_', ' ')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {app.hotkey && (
                      <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border ${
                        isNight ? 'border-red-800 bg-black text-red-400' : 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                      }`}>
                        {app.hotkey}
                      </span>
                    )}

                    <button
                      id={`btn-fav-${app.id}`}
                      onClick={() => {
                        playTacticalClick(audioEnabled);
                        onToggleFavorite(app.id);
                      }}
                      className={`p-1 rounded transition-colors ${
                        app.favorite ? 'text-amber-400' : 'text-zinc-600 hover:text-amber-300'
                      }`}
                      title={app.favorite ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <Star className={`w-3.5 h-3.5 ${app.favorite ? 'fill-amber-400' : ''}`} />
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-zinc-400 leading-snug line-clamp-2 min-h-[2rem]">
                  {app.description}
                </p>

                {/* Executable Path Check Badge */}
                <div className={`p-2 rounded-xl border text-[10px] truncate flex items-center justify-between ${
                  app.installed
                    ? isNight ? 'border-red-950 bg-red-950/30 text-red-400' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-red-900/60 bg-red-950/30 text-red-300'
                }`}>
                  <span className="truncate pr-1 font-mono">{app.uri || app.executablePath}</span>
                  {app.installed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" title="Executable Verified" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" title="Executable Path Not Found" />
                  )}
                </div>
              </div>

              {/* Action Buttons: Launch, Edit */}
              <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/80">
                <button
                  id={`btn-launch-${app.id}`}
                  onClick={() => handleLaunch(app)}
                  className={`flex-1 py-1.5 px-3 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 touch-manipulation border ${
                    isNight
                      ? 'bg-red-800 hover:bg-red-700 text-white border-red-600'
                      : isSunlight
                      ? 'bg-amber-400 hover:bg-amber-500 text-slate-950 border-amber-600 font-extrabold'
                      : 'bg-amber-500 hover:bg-amber-400 text-black border-amber-400 font-extrabold shadow-md'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>LAUNCH APP</span>
                </button>

                <button
                  id={`btn-edit-${app.id}`}
                  onClick={() => {
                    playTacticalClick(audioEnabled);
                    onEditApp(app);
                  }}
                  className={`p-1.5 rounded-xl border transition-all active:scale-95 ${
                    isNight ? 'border-red-950 bg-black text-red-400' : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-100'
                  }`}
                  title="Edit App Settings & Paths"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              </div>

            </div>
          );
        })}
      </div>

      {/* Launch Feedback Overlay Modal */}
      {launchingApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono">
          <div className="max-w-md w-full p-6 rounded-2xl border border-cyan-500 bg-slate-950 text-slate-100 space-y-4 text-center shadow-2xl animate-in fade-in zoom-in-95">
            <div className="w-12 h-12 rounded-full border border-cyan-400 bg-cyan-950 text-cyan-300 flex items-center justify-center mx-auto animate-bounce">
              <Play className="w-6 h-6 fill-current" />
            </div>

            <div>
              <h3 className="text-lg font-black text-cyan-300 uppercase">LAUNCHING {launchingApp.name}...</h3>
              <p className="text-xs text-slate-400 mt-1 font-mono">{launchingApp.executablePath}</p>
            </div>

            <div className="p-3 rounded-lg border border-slate-800 bg-slate-900 text-left text-xs font-mono space-y-1">
              <div className="flex justify-between text-slate-400">
                <span>SYSTEM STATUS:</span>
                <span className="text-emerald-400 font-bold">PROCESS DISPATCHED</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>ARGS:</span>
                <span className="text-cyan-300">{launchingApp.args || 'None'}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>HOTKEY:</span>
                <span className="text-amber-300">{launchingApp.hotkey || 'N/A'}</span>
              </div>
            </div>

            <p className="text-[11px] text-emerald-400 animate-pulse font-bold">
              ⚡ Executable invoked on Panasonic Toughbook OS.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
