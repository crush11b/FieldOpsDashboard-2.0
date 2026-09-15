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
  Edit2,
  ExternalLink,
  ChevronUp,
  ChevronDown,
  Layers,
  Sparkles,
  Zap
} from 'lucide-react';
import { UIThemeMode } from '../types';
import { AppCatalogCategory, AppCatalogRecord, isCatalogTargetConfigured } from '../appCatalog/domain';
import type { AppDiscoveryObservation } from '../appCatalog/discovery';
import { playTacticalClick } from '../utils/audio';

interface AppLauncherGridProps {
  apps: AppCatalogRecord[];
  theme: UIThemeMode;
  audioEnabled: boolean;
  gridColumns: 2 | 3 | 4 | 6;
  onToggleFavorite: (appId: string) => void;
  onEditApp: (app: AppCatalogRecord) => void;
  onAddNewApp: () => void;
  launchStates: Record<string, string | undefined>;
  onLaunchApp: (appId: string) => void;
  runtimeObservations?: Readonly<Record<string, AppDiscoveryObservation>>;
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

const CATEGORIES: { id: AppCatalogCategory | 'all' | 'favorites'; label: string }[] = [
  { id: 'all', label: 'ALL APPS' },
  { id: 'favorites', label: '⭐ FAVORITES' },
  { id: 'Digital Comms', label: 'DIGITAL COMMS' },
  { id: 'APRS', label: 'APRS' },
  { id: 'Satellite Ops', label: 'SATELLITE OPS' },
  { id: 'Network Voice', label: 'NETWORK VOICE' },
  { id: 'POTA/SOTA', label: 'POTA/SOTA' },
  { id: 'Web Apps', label: 'WEB APPS' },
  { id: 'Utilities', label: 'UTILITIES' },
];

export const AppLauncherGrid: React.FC<AppLauncherGridProps> = ({
  apps,
  theme,
  audioEnabled,
  gridColumns,
  onToggleFavorite,
  onEditApp,
  onAddNewApp,
  launchStates,
  onLaunchApp,
  runtimeObservations = {},
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [accordionMode, setAccordionMode] = useState<boolean>(true);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  const isCategoryCollapsed = (catId: string) => {
    return collapsedCategories[catId] ?? true; // Default to collapsed
  };

  const toggleCategoryCollapse = (catId: string) => {
    playTacticalClick(audioEnabled);
    setCollapsedCategories(prev => ({
      ...prev,
      [catId]: !isCategoryCollapsed(catId)
    }));
  };

  const toggleAllCollapses = (collapse: boolean) => {
    playTacticalClick(audioEnabled);
    const newMap: Record<string, boolean> = {};
    CATEGORIES.forEach(c => {
      if (c.id !== 'all' && c.id !== 'favorites') {
        newMap[c.id] = collapse;
      }
    });
    setCollapsedCategories(newMap);
  };

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
      (app.target.kind === 'native' ? app.target.executablePath : app.target.kind === 'web' ? app.target.url : '').toLowerCase().includes(searchQuery.toLowerCase());

    return matchesCategory && matchesSearch;
  });

  const renderAppCard = (app: AppCatalogRecord) => {
    const launchState = launchStates[app.id] ?? 'READY';
    const observation = runtimeObservations[app.id];
    const runtimeStatus = observation?.available ?? 'unknown';
    const runtimeStatusClass = !observation || runtimeStatus === 'unknown'
      ? 'fo-status-neutral'
      : runtimeStatus === 'yes'
        ? 'fo-status-success'
        : 'fo-status-danger';
    const relationship = observation?.fieldOpsEvidence?.label ?? (isCatalogTargetConfigured(app.target) ? 'LAUNCHER ONLY' : 'CATALOG ONLY');
    const launching = launchState === 'LAUNCHING';
    return (
      <div
        key={app.id}
        className="fo-surface p-3.5 rounded-2xl border flex flex-col justify-between gap-3 transition-colors relative group shadow-md fo-card-interactive"
      >
        {/* Top Row: Icon, Name, Category, Hotkey, Favorite */}
        <div className="space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="fo-surface-subtle fo-text-accent p-2 rounded-xl border shrink-0">
                {getAppIcon(app.iconName, "w-4 h-4")}
              </div>
              <div>
                <h4 className="fo-text-primary font-black text-sm tracking-wide leading-tight line-clamp-1">{app.name}</h4>
                <span className="fo-text-muted text-[10px] uppercase font-bold">
                  {app.category}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {app.hotkey && (
                <span className="fo-badge text-[9px] font-extrabold px-1.5 py-0.5 rounded border">
                  {app.hotkey}
                </span>
              )}

              <button
                id={`btn-fav-${app.id}`}
                aria-pressed={app.favorite}
                onClick={() => {
                  playTacticalClick(audioEnabled);
                  onToggleFavorite(app.id);
                }}
                className="fo-favorite fo-control min-h-11 min-w-11 p-2 rounded-xl border transition-colors flex items-center justify-center"
                title={app.favorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star className={`w-4 h-4 ${app.favorite ? 'fill-current' : ''}`} />
              </button>
            </div>
          </div>

          <p className="fo-text-secondary text-[11px] leading-snug line-clamp-2 min-h-[2rem]">
            {app.description}
          </p>

          {/* Durable target state; runtime discovery remains read-only. */}
          <div className={`p-2 rounded-xl border text-[10px] truncate flex items-center justify-between ${
            !app.enabled ? 'fo-status-caution' : isCatalogTargetConfigured(app.target) ? 'fo-status-info' : 'fo-status-neutral'
          }`}>
            <span className="truncate pr-1 font-mono">{app.target.kind === 'native' ? app.target.executablePath : app.target.kind === 'web' ? app.target.url : 'Unsupported target'}</span>
            {!app.enabled ? (
              <span className="flex items-center gap-1" title="This catalog record is disabled">
                DISABLED <XCircle className="w-3.5 h-3.5 shrink-0" />
              </span>
            ) : isCatalogTargetConfigured(app.target) ? (
              <span className="flex items-center gap-1" title="Configured only; runtime verification is unavailable">
                CONFIGURED <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              </span>
            ) : (
              <span className="flex items-center gap-1" title="No executable path is configured">
                NOT CONFIGURED <XCircle className="w-3.5 h-3.5 shrink-0" />
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-1.5 text-[9px] uppercase tracking-wide">
            <div className="fo-surface-subtle border rounded-lg p-2">
              <div className="fo-text-muted font-bold">DECLARED APP CAPABILITIES</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {app.capabilities.length > 0 ? app.capabilities.map(capability => <span key={capability.id} className="fo-status-info px-1.5 py-0.5 rounded border">{capability.label}</span>) : <span className="fo-text-muted">NONE DECLARED</span>}
              </div>
            </div>
            <div className="fo-surface-subtle border rounded-lg p-2">
              <div className="fo-text-muted font-bold">DEPENDENCIES</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {app.dependencies.length > 0 ? app.dependencies.map(dependency => {
                  const state = observation?.dependencyStates.find(candidate => candidate.id === dependency.id);
                  return <span key={dependency.id} className="fo-status-info px-1.5 py-0.5 rounded border">{dependency.id} {state?.status.toUpperCase() ?? 'UNKNOWN'}{dependency.required ? ' REQUIRED' : ' OPTIONAL'}</span>;
                }) : <span className="fo-text-muted">NONE DECLARED</span>}
              </div>
            </div>
            <div className="fo-surface-subtle border rounded-lg p-2">
              <div className="fo-text-muted font-bold">FIELDOPS RELATIONSHIP</div>
              <div className="fo-text-accent mt-1">{relationship}</div>
            </div>
            <div className="fo-surface-subtle border rounded-lg p-2">
              <div className="fo-text-muted font-bold">RUNTIME STATUS</div>
              <div className={`${runtimeStatusClass} mt-1 inline-flex rounded border px-1.5 py-0.5`}>{observation ? runtimeStatus.toUpperCase() : 'UNKNOWN'}</div>
            </div>
          </div>
        </div>

        {/* Action Buttons: Launch, Edit */}
        <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: 'var(--fo-border-subtle)' }}>
          <button
            id={`btn-launch-${app.id}`}
            disabled={launching || !app.enabled || !isCatalogTargetConfigured(app.target)}
            onClick={() => {
              playTacticalClick(audioEnabled);
              onLaunchApp(app.id);
            }}
            title="Launch through the FieldOps Tray"
            className={`flex-1 min-h-11 px-3 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 border transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${launching ? 'fo-control cursor-wait' : 'fo-control-primary'}`}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{launching ? 'LAUNCHING...' : app.enabled && isCatalogTargetConfigured(app.target) ? 'LAUNCH' : 'UNAVAILABLE'}</span>
          </button>

          <button
            id={`btn-edit-${app.id}`}
            disabled={!app.policy.editable}
            onClick={() => {
              playTacticalClick(audioEnabled);
              onEditApp(app);
            }}
            className="fo-control min-h-11 min-w-11 p-2 rounded-xl border transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 flex items-center justify-center"
            title={app.policy.editable ? 'Edit App Settings & Paths' : 'This record is protected from editing'}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        </div>
        <p id={`launch-status-${app.id}`} className={`text-[9px] ${launchState === 'Launched' || launchState === 'UriOpened' ? 'fo-text-success' : launchState === 'READY' ? 'fo-text-muted' : 'fo-text-caution'}`}>
          {launchState === 'READY' ? 'Launch is handled by the local FieldOps Tray.' : launchState}
        </p>
      </div>
    );
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
    <div className="space-y-4 font-mono" data-theme={theme}>
      {/* Field Applications Catalog Toolbar Header */}
      <div className="fo-surface p-4 rounded-2xl border shadow-xl space-y-3">
        
        {/* Top Title & Quick Stats Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b" style={{ borderColor: 'var(--fo-border-subtle)' }}>
          <div className="flex items-center gap-2.5">
            <div className="fo-surface-subtle fo-text-accent p-2 rounded-xl border">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="fo-text-primary font-black text-sm tracking-wider uppercase flex items-center gap-2">
                <span>FIELD APPLICATIONS CATALOG</span>
                <span className="fo-badge text-[10px] font-bold px-2 py-0.5 rounded border">
                  {apps.length} CATALOG ENTRIES
                </span>
              </h3>
              <p className="fo-text-secondary text-[11px] font-mono">
                Organize field tools. Native apps launch through the local FieldOps Tray; web apps open in the browser.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-48 sm:w-60">
              <Search className="fo-icon-neutral w-3.5 h-3.5 absolute left-3 top-[15px]" />
              <input
                id="input-search-apps"
                type="text"
                placeholder="Search tools & apps..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="fo-input min-h-11 w-full pl-8 pr-3 rounded-xl text-xs font-mono border"
              />
            </div>

            <button
              id="btn-auto-installer-suite"
              disabled
              aria-describedby="auto-installer-unavailable"
              className="fo-control min-h-11 px-3 rounded-xl text-xs font-extrabold flex items-center gap-1.5 border cursor-not-allowed opacity-70"
              title="Automatic installation and path verification are not yet implemented"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>AUTO-INSTALL UNAVAILABLE</span>
            </button>

            <button
              id="btn-add-custom-app"
              onClick={() => {
                playTacticalClick(audioEnabled);
                onAddNewApp();
              }}
              className="fo-control-primary min-h-11 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-95 border shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">ADD APP</span>
            </button>
          </div>
        </div>
        <p id="auto-installer-unavailable" className="fo-text-muted text-[10px]">
          Installation and executable verification require a future privileged local service.
        </p>

        {/* Category Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {CATEGORIES.map((cat) => {
            const active = selectedCategory === cat.id;
            return (
              <button
                id={`btn-cat-${cat.id}`}
                key={cat.id}
                aria-pressed={active}
                onClick={() => {
                  playTacticalClick(audioEnabled);
                  setSelectedCategory(cat.id);
                }}
                className="fo-theme-choice min-h-11 px-3 rounded-xl text-xs font-bold whitespace-nowrap transition-all active:scale-95 touch-manipulation border border-transparent"
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Filter Summary & View Toggle Footer */}
        <div className="fo-text-muted flex flex-wrap items-center justify-between text-[11px] font-mono pt-1 gap-2">
          <span>SHOWING {filteredApps.length} OF {apps.length} CATALOG RECORDS</span>
          
          <div className="flex items-center gap-2">
            {accordionMode && selectedCategory === 'all' && (
              <div className="flex items-center gap-1">
                <button
                  id="btn-expand-all-cats"
                  onClick={() => toggleAllCollapses(false)}
                  className="fo-control min-h-11 px-2 rounded-xl border text-[10px]"
                >
                  EXPAND ALL
                </button>
                <button
                  id="btn-collapse-all-cats"
                  onClick={() => toggleAllCollapses(true)}
                  className="fo-control min-h-11 px-2 rounded-xl border text-[10px]"
                >
                  COLLAPSE ALL
                </button>
              </div>
            )}

            <button
              id="btn-toggle-catalog-view-mode"
              aria-pressed={accordionMode}
              onClick={() => {
                playTacticalClick(audioEnabled);
                setAccordionMode(!accordionMode);
              }}
              className="fo-theme-choice min-h-11 px-2.5 rounded-xl border border-transparent font-bold text-[10px] flex items-center gap-1 transition-all active:scale-95"
            >
              <Layers className="w-3 h-3" />
              <span>{accordionMode ? '📁 GROUPED ACCORDIONS' : '⚡ FULL GRID'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Apps Display: Grouped Accordions vs Flat Grid */}
      {accordionMode && selectedCategory === 'all' ? (
        <div className="space-y-3">
          {CATEGORIES.filter(c => c.id !== 'all' && c.id !== 'favorites').map((cat) => {
            const catApps = filteredApps.filter(a => a.category === cat.id);
            if (catApps.length === 0) return null;
            const isCollapsed = searchQuery.trim().length === 0 && isCategoryCollapsed(cat.id);

            return (
              <div key={cat.id} className="fo-surface rounded-2xl border overflow-hidden transition-all">
                {/* Category Accordion Header */}
                <button
                  id={`btn-toggle-cat-accordion-${cat.id}`}
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleCategoryCollapse(cat.id)}
                  className="fo-card-interactive min-h-11 w-full p-3.5 flex items-center justify-between text-left transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="fo-badge p-1.5 rounded-lg border font-bold text-xs">
                      {cat.label}
                    </span>
                    <span className="fo-text-secondary text-xs font-bold font-mono">
                      ({catApps.length} {catApps.length === 1 ? 'TOOL' : 'TOOLS'})
                    </span>
                  </div>

                  <div className="fo-text-secondary flex items-center gap-2 text-xs font-bold">
                    <span className="text-[10px] hidden sm:inline uppercase opacity-75">
                      {isCollapsed ? 'CLICK TO EXPAND' : 'CLICK TO COLLAPSE'}
                    </span>
                    {isCollapsed ? <ChevronDown className="fo-text-accent w-4 h-4" /> : <ChevronUp className="fo-text-accent w-4 h-4" />}
                  </div>
                </button>

                {/* Category App Grid (Expanded) */}
                {!isCollapsed && (
                  <div className={`fo-surface-subtle p-3.5 border-t grid ${gridColClass} gap-3`}>
                    {catApps.map((app) => renderAppCard(app))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`grid ${gridColClass} gap-3`}>
          {filteredApps.map((app) => renderAppCard(app))}
        </div>
      )}

    </div>
  );
};
