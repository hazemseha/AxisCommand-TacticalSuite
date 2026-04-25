/**
 * otg-provision-web.js — Web fallback (no-op) for OTG plugin
 * OTG is Android-only; these stubs prevent crashes in browser dev.
 */
export class OtgProvisionWeb {
  async requestStoragePermission() {
    console.warn('[OTG] Web: Storage permission not available');
    return { granted: false };
  }

  async listRemovableVolumes() {
    console.warn('[OTG] Web: No removable volumes on web');
    return { volumes: [] };
  }

  async pickFolder() {
    console.warn('[OTG] Web: Folder picker not available');
    return { uri: '', path: '' };
  }

  async findFile() {
    return { found: false, filePath: '' };
  }

  async readFile() {
    return { data: '', size: 0 };
  }

  async copyFile() {
    return { success: false, bytesWritten: 0 };
  }

  async getInternalStoragePath() {
    return { path: '' };
  }
}
