# 🛡️ AxisCommand Tactical Suite

**Version 1.0 — Production Release**

> Offline-first tactical mapping and command platform for field operations. Built with zero-dependency offline architecture — no internet required, ever.

![Platform](https://img.shields.io/badge/Platform-Android-green)
![Version](https://img.shields.io/badge/Version-1.0-blue)
![Offline](https://img.shields.io/badge/Mode-100%25%20Offline-red)
![Encryption](https://img.shields.io/badge/Encryption-AES--256--GCM-purple)

---

## 📋 Features

### Tactical Mapping
- 🗺️ **Offline MBTiles Rendering** — Satellite + Street layers via local SQLite
- 📌 **Tactical Markers** — Custom military icon library with drag, rotate, scale
- 🛣️ **Route Drawing** — Polyline routes with distance/bearing calculations
- 📐 **Zone Management** — Polygon areas with area calculations
- 🎯 **MGRS Coordinate System** — Military Grid Reference overlay
- 📍 **Azimuth & Bearing Tools** — Directional measurement
- 🔄 **Tactical Figures** — NATO standard military symbols
- 🎨 **Freehand Drawing** — Sketch directly on map

### Security
- 🔐 **AES-256-GCM Encryption** — All tactical data encrypted at rest
- 👤 **Multi-User Authentication** — Isolated user accounts with hashed passwords (SHA-256)
- 🧹 **Emergency Panic Wipe** — One-button full data destruction
- 🔑 **Admin PIN Gate** — 4-digit admin control for user management
- 🌐 **Internet Lockdown** — Auto-locks if WiFi/data detected (OPSEC)

### Data Management
- 📂 **Folder Organization** — Group markers into tactical folders
- 📤 **GeoJSON Export** — Export tactical data for external tools
- 📥 **Data Import** — Import markers from GeoJSON/KML
- 🗑️ **Cascade Deletion** — Admin-controlled user and data removal
- 🔄 **Per-User Data Isolation** — Strict tenant architecture

### Advanced Tools
- 📡 **Mesh Chat** — Offline peer-to-peer messaging
- 🎥 **Video Integration** — Attach tactical video to markers
- 🔭 **Spyglass Tool** — Directional observation overlay
- 🎯 **Kill Box Zones** — Fire coordination areas
- 🏔️ **Line of Sight (LOS)** — Terrain-aware visibility analysis
- 💣 **Mortar FCS** — Fire control system calculations
- 📏 **Range Rings** — Distance radius overlay
- 🏃 **Track Recorder** — GPS movement logging
- 🛰️ **Blue Force Tracking** — Friendly unit positions

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│                  index.html                      │
│            (Single Page Application)             │
├──────────┬──────────┬──────────┬────────────────┤
│ auth.js  │ crypto.js│  db.js   │   main.js      │
│ Login    │ AES-256  │ IndexedDB│ Map Engine     │
│ Register │ PBKDF2   │ CRUD     │ UI Controller  │
│ Multi-   │ Key Mgmt │ userId   │ Event System   │
│ User     │ JWK      │ Filter   │ Boot Sequence  │
├──────────┴──────────┴──────────┴────────────────┤
│               Feature Modules                    │
│  tactical.js  │ features.js │ azimuth.js │ ...  │
├─────────────────────────────────────────────────┤
│            mbtiles-android.js                    │
│        SQLite → Leaflet Tile Bridge              │
├─────────────────────────────────────────────────┤
│          Capacitor (Native Bridge)               │
│     @capacitor-community/sqlite                  │
│     @capacitor/app │ @capacitor/filesystem       │
├─────────────────────────────────────────────────┤
│              Android APK                         │
└─────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
offline-map-app/
├── src/                    # Source code
│   ├── main.js             # Core app engine (boot, map, UI)
│   ├── auth.js             # Multi-user authentication
│   ├── crypto.js           # AES-256-GCM encryption engine
│   ├── db.js               # IndexedDB with user isolation
│   ├── mbtiles-android.js  # SQLite → Leaflet tile bridge
│   ├── features.js         # Marker/route/zone management
│   ├── tactical.js         # Tactical overlay system
│   ├── i18n.js             # Arabic/English translations
│   ├── styles.css          # Full UI stylesheet
│   └── assets/             # Icons, tactical symbols
├── android/                # Capacitor Android project
├── index.html              # Main app shell
├── capacitor.config.json   # Capacitor configuration
├── vite.config.js          # Build configuration
├── package.json            # Dependencies
└── scripts/                # Build utilities
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** 18+
- **Android Studio** (for APK builds)
- **Java JDK 17** (Android Studio bundled JBR)

### Install Dependencies
```bash
npm install
```

### Development (Web)
```bash
npm run dev
```

### Production Build
```bash
npm run build
```

### Android APK Build
```bash
# 1. Build web assets
npm run build

# 2. Sync to Android
npx cap sync android

# 3. Build APK
cd android
gradlew assembleDebug
```

The APK will be at: `android/app/build/outputs/apk/debug/app-debug.apk`

### Map Tile Deployment
Place `.db` tile files in the device's app storage:
```
/storage/emulated/0/Android/data/com.pinvault.tactical/files/
├── tripoli-satellite.db
└── tripoli-street.db
```

---

## 🔒 Security Architecture

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Authentication** | SHA-256 + PBKDF2 | Password hashing, never stored in plaintext |
| **Encryption** | AES-256-GCM | All tactical data encrypted at rest |
| **Key Derivation** | PBKDF2 (100K iterations) | Password → AES key |
| **Key Storage** | SessionStorage (JWK) | Survives page reload, cleared on tab close |
| **Data Isolation** | IndexedDB userId filter | Strict per-user data separation |
| **Panic Wipe** | Full localStorage/IndexedDB clear | Emergency data destruction |
| **Internet Lock** | navigator.onLine detection | Auto-locks if internet detected |

---

## 🔧 Key Technical Decisions

1. **`window.location.reload()` for Auth Transitions** — Prevents Leaflet double-mount crashes and event listener stacking. Crypto key survives via JWK export to sessionStorage.

2. **SQLite `closeMobileDatabases()` Before Reload** — NCConnections (non-conforming) can't be retrieved after page reload. Must close before reload and re-create.

3. **Legacy Data Migration** — Untagged data (pre-multi-user) is auto-tagged with the first user's ID on first read.

4. **Admin Gate Only for Fresh Devices** — Admin PIN verification only fires when `!hasUser() && getAllUsers().length === 0`.

---

## 📄 License

Private — All rights reserved.

---

## 📞 Maintainer

Built and maintained for tactical field operations.
