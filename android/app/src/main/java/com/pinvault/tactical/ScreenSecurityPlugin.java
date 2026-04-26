package com.pinvault.tactical;

import android.content.Context;
import android.hardware.display.DisplayManager;
import android.view.Display;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * ScreenSecurityPlugin — Detects external displays for TOC casting.
 * 
 * Fires events:
 *   externalDisplayConnected    — when a second display is added (TV/projector)
 *   externalDisplayDisconnected — when external display is removed
 *
 * Used by the JS layer to trigger the Secure Cast lockdown flow.
 */
@CapacitorPlugin(name = "ScreenSecurity")
public class ScreenSecurityPlugin extends Plugin {

    private DisplayManager displayManager;
    private DisplayManager.DisplayListener displayListener;
    private boolean externalDisplayActive = false;

    @Override
    public void load() {
        displayManager = (DisplayManager) getContext().getSystemService(Context.DISPLAY_SERVICE);
        
        displayListener = new DisplayManager.DisplayListener() {
            @Override
            public void onDisplayAdded(int displayId) {
                checkExternalDisplays();
            }

            @Override
            public void onDisplayRemoved(int displayId) {
                checkExternalDisplays();
            }

            @Override
            public void onDisplayChanged(int displayId) {
                checkExternalDisplays();
            }
        };

        displayManager.registerDisplayListener(displayListener, null);
        
        // Check initial state on plugin load
        checkExternalDisplays();
    }

    private void checkExternalDisplays() {
        Display[] displays = displayManager.getDisplays();
        boolean hasExternal = false;
        
        for (Display display : displays) {
            if (display.getDisplayId() != Display.DEFAULT_DISPLAY) {
                hasExternal = true;
                break;
            }
        }

        if (hasExternal && !externalDisplayActive) {
            externalDisplayActive = true;
            JSObject data = new JSObject();
            data.put("displayCount", displays.length);
            notifyListeners("externalDisplayConnected", data);
        } else if (!hasExternal && externalDisplayActive) {
            externalDisplayActive = false;
            JSObject data = new JSObject();
            data.put("displayCount", displays.length);
            notifyListeners("externalDisplayDisconnected", data);
        }
    }

    @PluginMethod
    public void getDisplayCount(com.getcapacitor.PluginCall call) {
        Display[] displays = displayManager.getDisplays();
        JSObject ret = new JSObject();
        ret.put("count", displays.length);
        ret.put("hasExternal", displays.length > 1);
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        if (displayManager != null && displayListener != null) {
            displayManager.unregisterDisplayListener(displayListener);
        }
    }
}
