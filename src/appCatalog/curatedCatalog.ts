import { APP_CAPABILITY_REGISTRY, type AppCapabilityId, type AppCatalogConfig, type AppCatalogRecord, type AppCatalogTarget } from './domain';

const curatedPolicy = { editable: true, disableable: true, deletable: true, restorable: true } as const;

type CuratedOptions = {
  id: string;
  name: string;
  category: AppCatalogRecord['category'];
  iconName: string;
  description: string;
  target?: AppCatalogTarget;
  enabled?: boolean;
  favorite?: boolean;
  hotkey?: string;
  capabilities?: AppCatalogRecord['capabilities'];
  dependencies?: AppCatalogRecord['dependencies'];
};

const capability = (id: AppCapabilityId): AppCatalogRecord['capabilities'][number] => ({
  id,
  label: APP_CAPABILITY_REGISTRY.find(entry => entry.id === id)?.label ?? id,
});

const curated = (options: CuratedOptions): AppCatalogRecord => ({
  id: options.id,
  name: options.name,
  category: options.category,
  iconName: options.iconName,
  description: options.description,
  owner: 'curated_default',
  target: options.target ?? { kind: 'unsupported', reason: 'missing' },
  capabilities: options.capabilities ?? [],
  dependencies: options.dependencies ?? [],
  enabled: options.enabled ?? true,
  favorite: options.favorite ?? false,
  ...(options.hotkey ? { hotkey: options.hotkey } : {}),
  policy: curatedPolicy,
});

export const CURATED_APP_CATALOG_RECORDS: readonly AppCatalogRecord[] = [
  curated({ id: 'wsjtx', name: 'WSJT-X', category: 'Digital Comms', iconName: 'Radio', description: 'Weak-signal digital communications; FieldOps retains read-only evidence only.', target: { kind: 'native', executablePath: 'C:\\WSJT\\wsjtx\\bin\\wsjtx.exe' }, favorite: true, hotkey: 'F1', capabilities: [capability('digital-operation')] }),
  curated({ id: 'winlink', name: 'WinLink Express', category: 'Digital Comms', iconName: 'Mail', description: 'Optional radio email application; FieldOps does not submit messages or integrate with it.', target: { kind: 'native', executablePath: 'C:\\RMS Express\\RMS Express.exe' }, favorite: true, hotkey: 'F2', capabilities: [capability('digital-operation')] }),
  curated({ id: 'varahf', name: 'Vara HF', category: 'Digital Comms', iconName: 'Activity', description: 'Optional HF modem dependency for supported external applications.', target: { kind: 'native', executablePath: 'C:\\VARA\\VARA.exe' }, favorite: true, capabilities: [capability('software-modem')] }),
  curated({ id: 'varafm', name: 'Vara FM', category: 'Digital Comms', iconName: 'Zap', description: 'Optional FM modem dependency for supported external applications.', target: { kind: 'native', executablePath: 'C:\\VARA FM\\VARAFM.exe' }, capabilities: [capability('software-modem')] }),
  curated({ id: 'js8call', name: 'JS8Call', category: 'Digital Comms', iconName: 'MessageSquareCode', description: 'Optional weak-signal keyboard messaging application; no FieldOps control claim.', target: { kind: 'native', executablePath: 'C:\\Program Files (x86)\\js8call\\bin\\js8call.exe' }, favorite: true, hotkey: 'F3', capabilities: [capability('digital-operation')] }),
  curated({ id: 'gridtracker', name: 'GridTracker', category: 'Digital Comms', iconName: 'Globe', description: 'Optional WSJT-X traffic visualizer; no live FieldOps integration claim.', target: { kind: 'native', executablePath: 'C:\\Users\\stick\\AppData\\Local\\Programs\\GridTracker2\\GridTracker2.exe' }, favorite: true }),
  curated({ id: 'jtalert', name: 'JTAlert', category: 'Digital Comms', iconName: 'BellRing', description: 'Optional alert helper for WSJT-X and JTDX.', target: { kind: 'native', executablePath: 'C:\\Program Files (x86)\\HamApps\\JTAlertV2\\JTAlertV2.exe' } }),
  curated({ id: 'mshv', name: 'MSHV', category: 'Digital Comms', iconName: 'Layers', description: 'Optional multi-slot digital and meteor-scatter application.', target: { kind: 'native', executablePath: 'C:\\RadioTools\\MSHV\\MSHV_WIN64.exe' }, capabilities: [capability('digital-operation')] }),
  curated({ id: 'fldigi', name: 'FlDigi', category: 'Digital Comms', iconName: 'Binary', description: 'Optional multi-mode digital modem suite; no FieldOps integration claim.', target: { kind: 'native', executablePath: 'C:\\Program Files\\Fldigi-4.2.06\\fldigi.exe' }, favorite: true, hotkey: 'F4', capabilities: [capability('digital-operation'), capability('software-modem')] }),
  curated({ id: 'flrig', name: 'FlRig', category: 'Utilities', iconName: 'SlidersHorizontal', description: 'Optional external application; external-radio-control describes FlRig only and does not authorize FieldOps CAT, PTT, tuning, or radio control.', capabilities: [capability('external-radio-control')] }),

  curated({ id: 'yaac', name: 'YAAC', category: 'APRS', iconName: 'Map', description: 'Deprioritized APRS application; Java target is unsupported and disabled by default.', enabled: false, capabilities: [capability('aprs'), capability('mapping')] }),
  curated({ id: 'direwolf', name: 'Direwolf', category: 'APRS', iconName: 'Cpu', description: 'Optional software TNC application; no FieldOps-owned TNC or packet control.', target: { kind: 'native', executablePath: 'C:\\RadioTools\\Direwolf\\direwolf.exe' }, favorite: true, capabilities: [capability('aprs'), capability('software-modem')] }),
  curated({ id: 'pinpoint', name: 'PinPoint', category: 'APRS', iconName: 'MapPin', description: 'Prioritized optional offline APRS mapping application; no direct APRS integration claim.', target: { kind: 'native', executablePath: 'C:\\Program Files (x86)\\PinPoint APRS\\PinPoint.exe' }, favorite: true, hotkey: 'F5', capabilities: [capability('aprs'), capability('mapping')] }),

  curated({ id: 'gpredict', name: 'GPredict', category: 'Satellite Ops', iconName: 'Navigation', description: 'Optional satellite tracking and orbit prediction application; no automatic radio or rotor control.', target: { kind: 'native', executablePath: 'C:\\RadioTools\\GPredict\\gpredict-win32-2.3.37\\gpredict.exe' }, favorite: true, capabilities: [capability('satellite-operations')] }),
  curated({ id: 'uiss', name: 'UISS', category: 'Satellite Ops', iconName: 'Compass', description: 'Optional ISS and ARISS packet communications application; no FieldOps integration claim.', target: { kind: 'native', executablePath: 'C:\\UISS\\UISS.exe' }, capabilities: [capability('satellite-operations')] }),

  curated({ id: 'wiresx', name: 'Wires-X', category: 'Network Voice', iconName: 'Mic', description: 'Optional network voice application; no network-voice control claim.', target: { kind: 'native', executablePath: 'C:\\Program Files (x86)\\YAESUMUSEN\\WIRES-X\\Wires-X.exe' }, capabilities: [capability('network-voice')] }),
  curated({ id: 'dstar', name: 'D-Star Doozy', category: 'Network Voice', iconName: 'Headphones', description: 'Optional D-STAR voice application; no integration claim.', target: { kind: 'native', executablePath: 'C:\\Program Files (x86)\\pa7lim\\Doozy\\doozy.exe' }, capabilities: [capability('network-voice')] }),
  curated({ id: 'qso-one', name: 'QSO One', category: 'Network Voice', iconName: 'RadioTower', description: 'DMR and Fusion operation without a radio; FieldOps provides no radio control or integration.', capabilities: [capability('network-voice'), capability('remote-operation')] }),

  curated({ id: 'hamclock', name: 'HamClock', category: 'Web Apps', iconName: 'Clock', description: 'Configurable operator web destination; no personal LAN address is shipped.', capabilities: [capability('web-only')] }),
  curated({ id: 'hamdash', name: 'HamDashboard', category: 'Web Apps', iconName: 'LayoutGrid', description: 'Configurable operator web destination; availability is separate from FieldOps integration.', capabilities: [capability('web-only')] }),
  curated({ id: 'pskreporter', name: 'PSKReporter', category: 'Web Apps', iconName: 'Signal', description: 'Manual observed-RF web destination; evidence remains separately attributed.', target: { kind: 'web', url: 'https://pskreporter.info/pskmap.html' }, favorite: true, capabilities: [capability('web-only')] }),
  curated({ id: 'aprsfi', name: 'APRS.fi', category: 'Web Apps', iconName: 'Globe2', description: 'Manual APRS web destination with no personal coordinates or query in the default.', target: { kind: 'web', url: 'https://aprs.fi' }, capabilities: [capability('web-only'), capability('mapping'), capability('aprs')] }),
  curated({ id: 'fieldspotter', name: 'FieldSpotter', category: 'Web Apps', iconName: 'Eye', description: 'Manual web destination; no automatic spotting or submission claim.', target: { kind: 'web', url: 'https://fieldspotter.radio' }, favorite: true, capabilities: [capability('web-only')] }),
  curated({ id: 'qrz', name: 'QRZ Lookup', category: 'Web Apps', iconName: 'Search', description: 'Manual callsign lookup web destination; no lookup integration or credential handling.', target: { kind: 'web', url: 'https://www.qrz.com/lookup' }, capabilities: [capability('web-only')] }),
  curated({ id: 'websdr', name: 'WebSDR', category: 'Web Apps', iconName: 'RadioReceiver', description: 'Configurable or manual WebSDR destination; remote reception is available through the site, not receiver control.', capabilities: [capability('web-only'), capability('remote-reception')] }),
  curated({ id: 'sotlas', name: 'SOTLAS', category: 'Web Apps', iconName: 'Mountain', description: 'Manual SOTLAS web destination with no personal coordinates or query in the default.', target: { kind: 'web', url: 'https://sotl.as' }, capabilities: [capability('web-only'), capability('mapping')] }),

  curated({ id: 'hamrs', name: 'HamRS', category: 'POTA/SOTA', iconName: 'BookOpenCheck', description: 'Optional portable logbook; no direct log synchronization claim.', target: { kind: 'native', executablePath: 'C:\\Users\\FieldOp\\AppData\\Local\\Programs\\hamrs\\HAMRS.exe' }, favorite: true, hotkey: 'F6', capabilities: [capability('logging')] }),
  curated({ id: 'n1mm', name: 'N1mm Logger', category: 'POTA/SOTA', iconName: 'Award', description: 'Optional logging application; no contest integration claim.', target: { kind: 'native', executablePath: 'C:\\Program Files (x86)\\N1MM Logger+\\N1MM Logger+.exe' }, capabilities: [capability('logging')] }),
  curated({ id: 'ham2k', name: 'Ham2K', category: 'POTA/SOTA', iconName: 'BookMarked', description: 'Identity requires review; likely Ham2K/PoLo. Name is intentionally not settled.', enabled: false }),
  curated({ id: 'pota-spots', name: 'POTA Spots', category: 'POTA/SOTA', iconName: 'MapPinned', description: 'Manual web launcher only; no automatic spotting, provider, or submission integration.', target: { kind: 'web', url: 'https://pota.app/#/spots' }, capabilities: [capability('web-only'), capability('spot-viewing')] }),
  curated({ id: 'pota-log-upload', name: 'POTA Log Upload', category: 'POTA/SOTA', iconName: 'Upload', description: 'Manual web launcher only; FieldOps does not submit logs directly.', target: { kind: 'web', url: 'https://pota.app/#/user/logs' }, capabilities: [capability('web-only'), capability('manual-log-upload')] }),
  curated({ id: 'sota-spots', name: 'SOTA Spots', category: 'POTA/SOTA', iconName: 'MountainSnow', description: 'Manual web launcher only; no automatic spotting or provider integration.', target: { kind: 'web', url: 'https://www.sota.org.uk/plan-a-trip/spots' }, capabilities: [capability('web-only'), capability('spot-viewing')] }),
  curated({ id: 'sota-log-upload', name: 'SOTA Log Upload', category: 'POTA/SOTA', iconName: 'UploadCloud', description: 'Manual web launcher only; FieldOps does not submit logs directly.', target: { kind: 'web', url: 'https://www.sota.org.uk/your-sota/logs' }, capabilities: [capability('web-only'), capability('manual-log-upload')] }),

  curated({ id: 'wireguard', name: 'WireGuard', category: 'Utilities', iconName: 'ShieldCheck', description: 'Optional VPN utility; no FieldOps network administration claim.', target: { kind: 'native', executablePath: 'C:\\Program Files\\WireGuard\\wireguard.exe' }, favorite: true, capabilities: [capability('vpn'), capability('remote-operation')] }),
  curated({ id: 'bkttimesync', name: 'BktTimeSync', category: 'Utilities', iconName: 'Clock4', description: 'Disabled by default because native GNSS-backed clock synchronization is already available.', target: { kind: 'native', executablePath: 'C:\\Program Files (x86)\\BktTimeSync\\BktTimeSync.exe' }, enabled: false, capabilities: [capability('time-synchronization')] }),
  curated({ id: 'otto', name: 'Otto', category: 'Utilities', iconName: 'Bot', description: 'Unsupported shortcut target; no dependency or integration claim.', enabled: false }),
  curated({ id: 'antscope', name: 'AntScope', category: 'Utilities', iconName: 'Activity', description: 'Optional utility; no antenna-measurement integration claim.', capabilities: [capability('antenna-analysis')] }),
  curated({ id: 'band-chart', name: 'Band Chart', category: 'Utilities', iconName: 'BarChart3', description: 'Disabled because document launching is not an approved target.', enabled: false }),
  curated({ id: 'ht-commander', name: 'HT Commander', category: 'Utilities', iconName: 'Radio', description: 'Optional curated utility entry; external-radio-control describes HT Commander only and never grants FieldOps control.', capabilities: [capability('external-radio-control')] }),
  curated({ id: 'potacat', name: 'POTACAT', category: 'POTA/SOTA', iconName: 'NotebookTabs', description: 'Optional HF, digital, logging, and remote-phone utility; no FieldOps submission or radio-control integration claim.', capabilities: [capability('digital-operation'), capability('logging'), capability('remote-operation')] }),
];

export const CURATED_APP_CATALOG: AppCatalogConfig = {
  schemaVersion: 1,
  records: CURATED_APP_CATALOG_RECORDS,
  deletedBuiltInIds: [],
};
