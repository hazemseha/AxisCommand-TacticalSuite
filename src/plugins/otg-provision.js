/**
 * otg-provision.js — OTG USB Provisioning Plugin Wrapper
 * V2.0: Capacitor plugin bridge for Android OTG volume access.
 * 
 * Rebuilt from APK bundle otg-provision-CL3MGee9.js (649 bytes).
 * Provides methods for USB storage enumeration, file discovery,
 * and buffered file copying for tactical map databases.
 */
import { registerPlugin } from '@capacitor/core';

const DEPLOY_PACKAGE_NAME = 'AxisCommand_Deploy.tactical';

const OtgProvision = registerPlugin('OtgProvision', {
  web: () => import('./otg-provision-web.js').then(m => new m.OtgProvisionWeb())
});

/**
 * Request MANAGE_EXTERNAL_STORAGE permission (Android 11+).
 * Must be called before any file operations.
 */
export async function requestStoragePermission() {
  return OtgProvision.requestStoragePermission();
}

/**
 * List all removable USB/OTG volumes currently mounted.
 * @returns {{ volumes: Array<{ path: string, label: string, uuid: string }> }}
 */
export async function listRemovableVolumes() {
  return OtgProvision.listRemovableVolumes();
}

/**
 * Open SAF folder picker for the user to grant access to a USB directory.
 * @returns {{ uri: string, path: string }}
 */
export async function pickFolder() {
  return OtgProvision.pickFolder();
}

/**
 * Search for a specific file in the given directory tree.
 * @param {{ path: string, filename: string }}
 * @returns {{ found: boolean, filePath: string }}
 */
export async function findFile(options) {
  return OtgProvision.findFile(options);
}

/**
 * Read a file as base64 string (for small files like .tactical envelopes).
 * @param {{ path: string }}
 * @returns {{ data: string, size: number }}
 */
export async function readFile(options) {
  return OtgProvision.readFile(options);
}

/**
 * Copy a file from source to destination using 64KB buffered streams.
 * Designed for large MBTiles map databases to prevent OOM crashes.
 * @param {{ sourcePath: string, destinationPath: string }}
 * @returns {{ success: boolean, bytesWritten: number }}
 */
export async function copyFile(options) {
  return OtgProvision.copyFile(options);
}

/**
 * Get the internal storage path for the app's files directory.
 * @returns {{ path: string }}
 */
export async function getInternalStoragePath() {
  return OtgProvision.getInternalStoragePath();
}

export { OtgProvision, DEPLOY_PACKAGE_NAME };
