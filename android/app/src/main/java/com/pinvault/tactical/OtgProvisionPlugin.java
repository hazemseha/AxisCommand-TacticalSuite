package com.pinvault.tactical;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.provider.Settings;
import android.util.Log;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;

/**
 * OtgProvisionPlugin — Native Android plugin for USB OTG volume access.
 *
 * Features:
 * - StorageManager volume enumeration for removable USB drives
 * - SAF (Storage Access Framework) folder picker
 * - 64KB buffered stream copying for large MBTiles databases
 * - BroadcastReceiver for USB mount/unmount events
 * - MANAGE_EXTERNAL_STORAGE request for Android 11+
 */
@CapacitorPlugin(name = "OtgProvision")
public class OtgProvisionPlugin extends Plugin {

    private static final String TAG = "OtgProvision";
    private static final int BUFFER_SIZE = 64 * 1024; // 64KB buffer to prevent OOM

    private BroadcastReceiver usbReceiver;

    @Override
    public void load() {
        super.load();
        registerUsbReceiver();
        Log.i(TAG, "OtgProvisionPlugin loaded");
    }

    // ===== STORAGE PERMISSION (Android 11+) =====

    @PluginMethod
    public void requestStoragePermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (Environment.isExternalStorageManager()) {
                JSObject ret = new JSObject();
                ret.put("granted", true);
                call.resolve(ret);
            } else {
                try {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                    getActivity().startActivity(intent);
                    JSObject ret = new JSObject();
                    ret.put("granted", false);
                    ret.put("message", "Permission dialog opened. User must grant manually.");
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("Failed to request storage permission: " + e.getMessage());
                }
            }
        } else {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            ret.put("message", "Pre-Android 11, no special permission needed.");
            call.resolve(ret);
        }
    }

    // ===== VOLUME ENUMERATION =====

    @PluginMethod
    public void listRemovableVolumes(PluginCall call) {
        try {
            StorageManager sm = (StorageManager) getContext().getSystemService(Context.STORAGE_SERVICE);
            List<StorageVolume> volumes = sm.getStorageVolumes();
            JSArray arr = new JSArray();

            for (StorageVolume vol : volumes) {
                if (vol.isRemovable()) {
                    JSObject v = new JSObject();
                    v.put("label", vol.getDescription(getContext()));
                    v.put("uuid", vol.getUuid() != null ? vol.getUuid() : "");

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        File dir = vol.getDirectory();
                        v.put("path", dir != null ? dir.getAbsolutePath() : "");
                    } else {
                        v.put("path", "/storage/" + vol.getUuid());
                    }

                    arr.put(v);
                }
            }

            JSObject ret = new JSObject();
            ret.put("volumes", arr);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "listRemovableVolumes failed", e);
            call.reject("Failed to list volumes: " + e.getMessage());
        }
    }

    // ===== SAF FOLDER PICKER =====

    @PluginMethod
    public void pickFolder(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION |
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            );
            saveCall(call);
            startActivityForResult(call, intent, "pickFolderResult");
        } catch (Exception e) {
            call.reject("Failed to open folder picker: " + e.getMessage());
        }
    }

    // ===== FILE DISCOVERY =====

    @PluginMethod
    public void findFile(PluginCall call) {
        String path = call.getString("path", "");
        String filename = call.getString("filename", "");

        if (path.isEmpty() || filename.isEmpty()) {
            call.reject("path and filename are required");
            return;
        }

        try {
            File dir = new File(path);
            File found = searchFile(dir, filename);

            JSObject ret = new JSObject();
            if (found != null) {
                ret.put("found", true);
                ret.put("filePath", found.getAbsolutePath());
            } else {
                ret.put("found", false);
                ret.put("filePath", "");
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("findFile failed: " + e.getMessage());
        }
    }

    private File searchFile(File dir, String targetName) {
        if (dir == null || !dir.isDirectory()) return null;

        File[] children = dir.listFiles();
        if (children == null) return null;

        for (File child : children) {
            if (child.isFile() && child.getName().equals(targetName)) {
                return child;
            }
            if (child.isDirectory()) {
                File result = searchFile(child, targetName);
                if (result != null) return result;
            }
        }
        return null;
    }

    // ===== FILE READ (Base64) =====

    @PluginMethod
    public void readFile(PluginCall call) {
        String path = call.getString("path", "");
        if (path.isEmpty()) {
            call.reject("path is required");
            return;
        }

        try {
            File file = new File(path);
            byte[] bytes = new byte[(int) file.length()];
            FileInputStream fis = new FileInputStream(file);
            fis.read(bytes);
            fis.close();

            String base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);

            JSObject ret = new JSObject();
            ret.put("data", base64);
            ret.put("size", file.length());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("readFile failed: " + e.getMessage());
        }
    }

    // ===== BUFFERED FILE COPY (64KB) =====

    @PluginMethod
    public void copyFile(PluginCall call) {
        String sourcePath = call.getString("sourcePath", "");
        String destinationPath = call.getString("destinationPath", "");

        if (sourcePath.isEmpty() || destinationPath.isEmpty()) {
            call.reject("sourcePath and destinationPath are required");
            return;
        }

        try {
            File source = new File(sourcePath);
            File dest = new File(destinationPath);

            // Ensure parent directories exist
            if (dest.getParentFile() != null) {
                dest.getParentFile().mkdirs();
            }

            long bytesWritten = 0;
            byte[] buffer = new byte[BUFFER_SIZE];

            InputStream in = new FileInputStream(source);
            OutputStream out = new FileOutputStream(dest);

            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
                bytesWritten += read;
            }

            out.flush();
            out.close();
            in.close();

            Log.i(TAG, "copyFile: " + bytesWritten + " bytes written to " + destinationPath);

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("bytesWritten", bytesWritten);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "copyFile failed", e);
            call.reject("copyFile failed: " + e.getMessage());
        }
    }

    // ===== INTERNAL STORAGE PATH =====

    @PluginMethod
    public void getInternalStoragePath(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("path", getContext().getFilesDir().getAbsolutePath());
        call.resolve(ret);
    }

    // ===== USB BROADCAST RECEIVER =====

    private void registerUsbReceiver() {
        usbReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (action == null) return;

                JSObject data = new JSObject();
                if (Intent.ACTION_MEDIA_MOUNTED.equals(action)) {
                    Uri uri = intent.getData();
                    data.put("path", uri != null ? uri.getPath() : "");
                    notifyListeners("otgMounted", data);
                    Log.i(TAG, "OTG device mounted: " + (uri != null ? uri.getPath() : "unknown"));
                } else if (Intent.ACTION_MEDIA_UNMOUNTED.equals(action) ||
                           Intent.ACTION_MEDIA_REMOVED.equals(action)) {
                    notifyListeners("otgRemoved", data);
                    Log.i(TAG, "OTG device removed");
                }
            }
        };

        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_MEDIA_MOUNTED);
        filter.addAction(Intent.ACTION_MEDIA_UNMOUNTED);
        filter.addAction(Intent.ACTION_MEDIA_REMOVED);
        filter.addDataScheme("file");

        getContext().registerReceiver(usbReceiver, filter);
    }

    @Override
    protected void handleOnDestroy() {
        if (usbReceiver != null) {
            try {
                getContext().unregisterReceiver(usbReceiver);
            } catch (Exception ignored) {}
        }
        super.handleOnDestroy();
    }
}
