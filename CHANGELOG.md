# Changelog

All notable changes to AxisCommand Tactical Suite are documented in this file.

## [1.0.0] — 2026-04-22

### 🎉 First Stable Production Release

#### Security & Authentication
- Multi-user authentication with SHA-256 hashed passwords
- AES-256-GCM encryption for all tactical data at rest (PBKDF2 key derivation, 100K iterations)
- Crypto key persistence via JWK export to sessionStorage (survives page reloads)
- Admin PIN gate (4-digit) for user management operations
- Emergency Panic Wipe — one-button full data destruction
- Internet lockdown — auto-locks app if WiFi/cellular detected (OPSEC)
- Strict per-user data isolation (tenant architecture with userId filtering)
- Ghost user elimination — strict auth gate validates registry before login
- Legacy data migration — auto-tags untagged records on first read

#### Tactical Mapping
- Offline MBTiles rendering (Satellite + Street via local SQLite NCConnections)
- Custom tactical icon library with NATO military symbols
- Marker placement, drag, rotate, scale with zoom-responsive rendering
- Route drawing with distance/bearing calculations
- Zone management with polygon area calculations  
- MGRS coordinate grid overlay
- Azimuth & bearing measurement tools
- Freehand drawing on map
- Tactical figures (NATO standard)

#### Advanced Tools
- Mesh Chat (offline peer-to-peer messaging)
- Kill Box zone management
- Line of Sight (LOS) analysis
- Mortar Fire Control System (FCS)
- Range Rings overlay
- Track Recorder (GPS movement logging)
- Blue Force Tracking
- Spyglass directional observation
- Video integration for markers

#### Data Management
- Folder-based marker organization
- GeoJSON/KML export and import
- Admin-controlled cascade user deletion
- Per-user data isolation with strict userId filtering

#### Platform
- Capacitor 8 + Android native bridge
- Vite 8 production build pipeline
- SQLite connection lifecycle management (close before reload, re-create on boot)
- Clean reload architecture (no duplicate event listeners)
- Arabic/English bilingual (i18n)

---

## Development History

The project evolved through the following phases:
- **V6.x** — Initial portable build with basic auth and map rendering
- **V7.x** — Multi-user support, encryption engine, tactical tools expansion
- **V8.0–V8.7** — Critical security hardening, data isolation, SQLite lifecycle fixes
- **V1.0** — Final stable production release (V8.7 promoted to V1.0)
