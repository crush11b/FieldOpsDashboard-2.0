# FieldOps Dashboard

> Rugged, offline-first Tactical Launch Platform and Operations Dashboard for Ham Radio Field Operators, POTA/SOTA Activators, and EMCOMM Teams running Panasonic ToughBook / ToughPad hardware.

![FieldOps Dashboard](https://img.shields.io/badge/Platform-Panasonic_ToughBook_%2F_ToughPad-004B87?style=for-the-badge&logo=windows&logoColor=white)
![Build Status](https://img.shields.io/badge/Status-Field_Ready-00C853?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

---

## 🛰️ Key Features

### 📡 GNSS / Serial GPS Integration
- **Direct COM Port Selection**: Select hardware COM ports (e.g., `COM6 (GPS Receiver)`, `COM1` through `COM16`, Linux `/dev/ttyUSB0`, `/dev/ttyACM0`) or enter custom serial device strings.
- **NMEA Baud Rate Tuning**: Support for standard NMEA 0183 baud rates (4800, 9600, 19200, 38400, 57600, 115200 BAUD).
- **Automatic Maidenhead Grid Locator**: Instant conversion of GPS lat/lon into 6-character Maidenhead grid squares (e.g., `DN17bv`) with satellite constellation fix status (3D Fix, 2D Fix, RTK).

### 🔋 Dual-Battery System Monitoring
- **ToughBook / ToughPad Dual-Power WMI Query**: Hardware polling engine querying Windows WMI (`Win32_Battery`) or Linux sysfs for both **Main Tablet Battery (BAT1)** and **Keyboard Dock Battery (BAT2)**.
- **Fallbacks & Web Battery API**: Automatic fallback to browser `navigator.getBattery` driver API when available.
- **Manual Calibration Mode**: Slider override panel for testing battery thresholds, critical warnings, and uncoupled keyboard dock scenarios.

### 📻 Ham Radio App Launcher & Quick Tools
- **Tactical Launch Grid**: Configurable 2, 3, 4, or 6 column grid for WSJT-X, FLdigi, N1MM Log, Ham Radio Deluxe, Chirp, GridTracker, QRZ, and custom field software.
- **Configuration Persistence**: Save and export application setups via JSON config modal.

### 📜 SmartLog+ ADIF Logger
- **Rapid Contact Logging**: Log QSOs with Call, Frequency, Mode, RST, and Maidenhead Grid square.
- **Distance & Bearing Stats**: Automatic distance (miles/km) and bearing angle calculation relative to your current station grid.
- **ADIF File Import & Export**: Full ADIF (Amateur Data Interchange Format) file generator and reader for seamless upload to LoTW, QRZ, or eQL.

### 🌤️ HF Propagation & Tactical Weather
- **VOACAP HF Band Condition Status**: Real-time evaluation for 80m, 40m, 20m, 15m, 10m, and 6m bands based on Solar Flux Index (SFI), K-index, and A-index.
- **NOAA Weather & Field Alerting**: Field weather station widget with active emergency weather alert banners.

### 🎨 Tactical Field Display Modes
- **Tactical Dark Mode**: Low-glare dark layout optimized for command tents.
- **Night Vision Mode**: Monochromatic red phosphor theme preventing night-vision eye degradation.
- **Sunlight Readable Mode**: Ultra-high contrast light theme designed for outdoor sunlight activation.
- **OLED Monochrome Amber**: Classic vintage military terminal styling.

---

## 🛠️ Architecture & Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons, Framer Motion
- **Backend**: Express.js server (`server.ts`) bundled with `esbuild` to CommonJS (`dist/server.cjs`)
- **System Integration**: Node.js `child_process` execution for PowerShell WMI queries and native OS device access

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ or 20+
- Windows 10/11 (for direct ToughBook WMI hardware battery queries) or Linux (Debian/Ubuntu/Arch)

### Installation & Execution

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/field-ops-dashboard.git
   cd field-ops-dashboard
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the Development Server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

4. **Build for Production / Offline Deployment:**
   ```bash
   npm run build
   npm start
   ```

---

## 📁 Repository Structure

```
.
├── server.ts                       # Express.js backend & hardware API endpoints
├── src/
│   ├── App.tsx                     # Main tactical field dashboard container
│   ├── types.ts                    # Global TypeScript interfaces & data models
│   ├── components/
│   │   ├── BatteryStatusWidget.tsx # ToughBook/ToughPad dual battery monitor
│   │   ├── GPSGridWidget.tsx       # GNSS COM Port selector & Maidenhead grid
│   │   ├── ConfigModal.tsx         # App grid & COM port settings modal
│   │   ├── SmartLogWidget.tsx      # ADIF contact logging engine
│   │   ├── PropagationWidget.tsx   # VOACAP HF propagation & solar flux
│   │   ├── WeatherWidget.tsx       # NOAA weather alert badge & forecast
│   │   └── AppLauncherGrid.tsx     # Tactical software app grid
│   └── data/
│       └── defaultConfig.ts        # Default configuration & app links
├── package.json                    # NPM build scripts & dependencies
└── README.md                       # Documentation
```

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
