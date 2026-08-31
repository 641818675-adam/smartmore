package com.smartmore.partfinder;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.DisplayMetrics;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * PartFinder 移动端宿主壳。
 *
 * 设计约束：
 * 1. 零第三方依赖 —— 仅使用 android.* 平台 API，保证完全离线可构建。
 * 2. 折叠屏连续态 —— Activity 声明了全部 configChanges，展开/折叠时不重建，
 *    WebView 的滚动位置、输入内容、选中项全部保持。
 * 3. 应用本体是 assets/web 下的单页应用，原生层只负责承载，不参与业务。
 */
public class MainActivity extends Activity {

    private static final String APP_URL = "file:///android_asset/web/index.html";
    private static final String PREFS = "partfinder_prefs";

    /**
     * 前端层叠（详情 sheet / 弹层）是否打开。
     * JS 通过桥接 reportOverlay 上报；返回键据此逐层退出而不是直接结束应用（R2-01）。
     * 单页应用 webView.canGoBack() 恒为 false，不能依赖历史栈。
     */
    private static volatile boolean overlayOpen = false;

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setupWindow();

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);

        configureWebView(webView);

        if (savedInstanceState == null) {
            webView.loadUrl(APP_URL);
        }
    }

    private void setupWindow() {
        Window window = getWindow();
        // 边到边绘制：内容延伸到状态栏与导航栏之下，由 CSS 安全区变量控制内边距。
        window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // 适配 Fold3 内屏/外屏的开孔区域
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(lp);
        }
        // 软键盘弹出时压缩布局，保证搜索框不被遮挡
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    }

    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        // 允许 file:// 页面通过 XHR 读取同目录数据集，离线数据集依赖此项
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        // 禁止缩放，避免误触破坏移动端布局；字号跟随系统无障碍设置
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setTextZoom(100);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setDefaultTextEncodingName("utf-8");

        // 禁止加载任何外部网络内容：应用完全离线，缩小攻击面
        settings.setBlockNetworkLoads(true);
        settings.setBlockNetworkImage(true);

        view.addJavascriptInterface(new Bridge(this), "Android");
        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                // 只放行本地资产，外部链接一律拦截
                return url != null && !url.startsWith("file:///android_asset/");
            }
        });
        view.setWebChromeClient(new WebChromeClient());
        view.setHorizontalScrollBarEnabled(false);
        view.setVerticalScrollBarEnabled(false);

        // 确保 WebView 在触摸模式下能够获得焦点，否则页面 input 与点击事件无法生效
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
        view.requestFocusFromTouch();
        view.requestFocus();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(false);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) {
            webView.saveState(outState);
        }
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        super.onRestoreInstanceState(savedInstanceState);
        if (webView != null) {
            webView.restoreState(savedInstanceState);
        }
    }

    @Override
    public void onBackPressed() {
        // 层叠优先：详情 sheet / 弹层打开时，返回键先关闭它们（R2-01）
        if (overlayOpen && webView != null) {
            overlayOpen = false;
            webView.evaluateJavascript(
                    "if(window.__pf&&window.__pf.closeTop)window.__pf.closeTop();", null);
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // 让 WebView 内的输入框能正确处理删除键
        if (keyCode == KeyEvent.KEYCODE_DEL && webView != null) {
            webView.evaluateJavascript("(function(){return 1;})()", null);
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.evaluateJavascript("if(window.__pf&&window.__pf.pause)window.__pf.pause();", null);
            webView.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("if(window.__pf&&window.__pf.resume)window.__pf.resume();", null);
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) {
                parent.removeView(webView);
            }
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // 折叠/展开时通知前端重新计算布局（Activity 不重建）
        if (webView != null) {
            webView.evaluateJavascript(
                    "if(window.__pf&&window.__pf.onResize)window.__pf.onResize();", null);
        }
    }

    /** 供前端调用的最小原生能力集。file:// 不是安全上下文，剪贴板必须走原生。 */
    private static final class Bridge {
        private final Context context;

        Bridge(Context context) {
            this.context = context.getApplicationContext();
        }

        @JavascriptInterface
        public void copy(String text) {
            if (text == null) {
                return;
            }
            ClipboardManager cm =
                    (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null) {
                return;
            }
            cm.setPrimaryClip(ClipData.newPlainText("PartFinder", text));
        }

        /**
         * 读取剪贴板文本，供「从桌面版导入客户」预填粘贴内容。
         * file:// 页面不是安全上下文，JS 侧无法读剪贴板，必须走原生。
         * 无内容或读取失败返回空串（Android 10+ 限制后台读剪贴板，
         * 应用在前台时正常可用）。
         */
        @JavascriptInterface
        public String paste() {
            ClipboardManager cm =
                    (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null || !cm.hasPrimaryClip() || cm.getPrimaryClip() == null
                    || cm.getPrimaryClip().getItemCount() == 0) {
                return "";
            }
            CharSequence text = cm.getPrimaryClip().getItemAt(0).coerceToText(context);
            return text == null ? "" : text.toString();
        }

        @JavascriptInterface
        public void toast(String message) {
            if (message == null) {
                return;
            }
            Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
        }

        /** 返回屏幕 dp 宽度，供前端校验断点计算。 */
        @JavascriptInterface
        public int screenWidthDp() {
            DisplayMetrics dm = context.getResources().getDisplayMetrics();
            return Math.round(dm.widthPixels / dm.density);
        }

        /**
         * 偏好存储。file:// 页面的 localStorage 归属 null origin，可靠性不足，
         * 收藏与设置改为落在 SharedPreferences。
         */
        @JavascriptInterface
        public String getPref(String key) {
            if (key == null) {
                return null;
            }
            return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getString(key, null);
        }

        @JavascriptInterface
        public void setPref(String key, String value) {
            if (key == null) {
                return;
            }
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(key, value)
                    .apply();
        }

        /** 前端上报层叠状态（详情 sheet / 弹层），供返回键决定逐层退出还是结束应用。 */
        @JavascriptInterface
        public void reportOverlay(boolean open) {
            overlayOpen = open;
        }

        /**
         * 轻触觉反馈（收藏/复制/选中等"物理确认感"）。时长钳制 12-60ms，
         * 只给短促点击感不扰人；无振动硬件或权限缺失时静默忽略。
         */
        @JavascriptInterface
        public void vibrate(int ms) {
            int d = ms <= 0 ? 12 : Math.min(ms, 60);
            Vibrator v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) {
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createOneShot(d, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(d);
            }
        }
    }
}
