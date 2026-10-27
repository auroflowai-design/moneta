package com.moneta.personalfinance;

import android.app.UiModeManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.appcompat.app.AppCompatDelegate;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String PREFS = "moneta_launch";
    private static final String KEY_MODE = "theme_mode";
    private static final String KEY_RESOLVED = "theme_resolved";
    private static final String KEY_APPLIED_MODE = "theme_applied_mode";
    private static final long MIN_OVERLAY_MS = 1500;
    private static final long MAX_OVERLAY_MS = 4500;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private LaunchOverlay overlay;
    private long overlayShownAt;
    private boolean appReady;
    private boolean finishing;
    private boolean jsBridgeInstalled;
    private String currentMode = "system";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        currentMode = normalizeMode(prefs.getString(KEY_MODE, "system"));
        String appliedMode = prefs.getString(KEY_APPLIED_MODE, null);
        if (!currentMode.equals(appliedMode)) {
            applyAppNightMode(currentMode);
            prefs.edit().putString(KEY_APPLIED_MODE, currentMode).apply();
        }

        boolean light = "light".equals(currentMode)
            || ("system".equals(currentMode) && isSystemLight());

        super.onCreate(savedInstanceState);

        applySystemBars(light);
        overlayShownAt = SystemClock.uptimeMillis();
        overlay = new LaunchOverlay(this, light);
        ViewGroup content = findViewById(android.R.id.content);
        if (content != null) {
            final LaunchOverlay launch = overlay;
            content.addView(
                launch,
                new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            );
            // The minimum hold starts when the overlay is actually attached, so
            // time spent on the system splash never shortens the animation.
            launch.post(() -> {
                if (overlay != launch) return;
                overlayShownAt = SystemClock.uptimeMillis();
                launch.start();
            });
        }

        handler.postDelayed(() -> finishOverlay(true), MAX_OVERLAY_MS);
        installBackHandling();
    }

    private void installBackHandling() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Keep the splash overlay from being dismissed into a half-loaded app.
                if (overlay != null || finishing) return;
                WebView webView = bridge == null ? null : bridge.getWebView();
                if (webView == null) {
                    finish();
                    return;
                }
                webView.evaluateJavascript(
                    "(function(){try{return typeof window.MonetaBack === 'function' && window.MonetaBack() === true;}catch(e){return false;}})()",
                    result -> {
                        if (!"true".equals(result) && !isFinishing()) finish();
                    }
                );
            }
        });
    }

    @Override
    protected void load() {
        super.load();
        installJavascriptBridge();
    }

    private void installJavascriptBridge() {
        if (jsBridgeInstalled) return;
        try {
            WebView webView = bridge == null ? null : bridge.getWebView();
            if (webView == null) return;
            webView.addJavascriptInterface(new MonetaBridge(), "MonetaNative");
            jsBridgeInstalled = true;
        } catch (Exception ignored) {
            // The WebView may not be ready on very old devices; the timer fallback
            // still removes the overlay safely.
        }
    }

    private boolean isSystemLight() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode != Configuration.UI_MODE_NIGHT_YES;
    }

    private static String normalizeMode(String mode) {
        if ("light".equals(mode) || "dark".equals(mode)) return mode;
        return "system";
    }

    private void applyAppNightMode(String mode) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            int target = "light".equals(mode)
                ? UiModeManager.MODE_NIGHT_NO
                : "dark".equals(mode)
                    ? UiModeManager.MODE_NIGHT_YES
                    : UiModeManager.MODE_NIGHT_AUTO;
            try {
                UiModeManager manager = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
                if (manager != null) manager.setApplicationNightMode(target);
            } catch (Exception ignored) {}
        } else {
            int target = "light".equals(mode)
                ? AppCompatDelegate.MODE_NIGHT_NO
                : "dark".equals(mode)
                    ? AppCompatDelegate.MODE_NIGHT_YES
                    : AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM;
            if (AppCompatDelegate.getDefaultNightMode() != target) {
                AppCompatDelegate.setDefaultNightMode(target);
            }
        }
    }

    @SuppressWarnings("deprecation")
    private void applySystemBars(boolean light) {
        int background = light ? Color.rgb(244, 244, 242) : Color.rgb(11, 13, 16);
        getWindow().setBackgroundDrawable(new ColorDrawable(background));
        getWindow().setStatusBarColor(background);
        getWindow().setNavigationBarColor(background);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            getWindow(),
            getWindow().getDecorView()
        );
        controller.setAppearanceLightStatusBars(light);
        controller.setAppearanceLightNavigationBars(light);
    }

    private void finishOverlay(boolean force) {
        if (overlay == null || finishing) return;
        long elapsed = SystemClock.uptimeMillis() - overlayShownAt;
        if (!force && !appReady) return;
        if (!force && elapsed < MIN_OVERLAY_MS) {
            handler.postDelayed(
                () -> finishOverlay(false),
                Math.max(0, MIN_OVERLAY_MS - elapsed + 20)
            );
            return;
        }

        finishing = true;
        handler.removeCallbacksAndMessages(null);
        LaunchOverlay target = overlay;
        overlay = null;
        // Back presses stay ignored only while the overlay fades; after that the
        // callback must reach the WebView again.
        target.fadeOut(() -> finishing = false);
    }

    @Override
    public void onPause() {
        super.onPause();
        SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String appliedMode = prefs.getString(KEY_APPLIED_MODE, null);
        if (!currentMode.equals(appliedMode)) {
            applyAppNightMode(currentMode);
            prefs.edit().putString(KEY_APPLIED_MODE, currentMode).apply();
        }
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private final class MonetaBridge {

        @JavascriptInterface
        public void setTheme(String mode, String resolved) {
            final String nextMode = normalizeMode(mode);
            final boolean light = "light".equals(resolved);
            SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            prefs.edit()
                .putString(KEY_MODE, nextMode)
                .putString(KEY_RESOLVED, light ? "light" : "dark")
                .apply();
            runOnUiThread(() -> {
                currentMode = nextMode;
                if (overlay != null) overlay.setLight(light, true);
                applySystemBars(light);
            });
        }

        @JavascriptInterface
        public void ready() {
            runOnUiThread(() -> {
                if (appReady) return;
                appReady = true;
                finishOverlay(false);
            });
        }
    }
}
