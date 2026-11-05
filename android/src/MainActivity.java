package it.nathion.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.net.URI;

public class MainActivity extends Activity {
    private static final int MICROPHONE = 10;
    private LinearLayout root;
    private WebView web;
    private PermissionRequest pendingMicrophone;
    private URI server;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        String saved = getPreferences(MODE_PRIVATE).getString("server", "");
        if (saved.isEmpty()) showConnection();
        else connect(saved);
    }

    private void layout() {
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(12, 17, 24));
        setContentView(root);
    }

    private void showConnection() {
        closeWeb();
        layout();
        int padding = (int)(20 * getResources().getDisplayMetrics().density);
        root.setPadding(padding, padding, padding, padding);
        TextView intro = new TextView(this);
        intro.setText("NATHION\n\nConnetti Tailscale sul telefono e inserisci l’indirizzo HTTPS privato del PC.");
        intro.setTextSize(18);
        root.addView(intro);
        EditText address = new EditText(this);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setSingleLine(true);
        address.setHint("https://nome-pc.rete.ts.net:8443");
        int configuredHost = getResources().getIdentifier("private_host", "string", getPackageName());
        String preset = configuredHost == 0 ? "" : getString(configuredHost);
        address.setText(getPreferences(MODE_PRIVATE).getString("server", preset));
        root.addView(address);
        Button go = new Button(this);
        go.setText("Connetti al PC");
        go.setOnClickListener(view -> {
            if (!connect(address.getText().toString().trim())) address.setError("Inserisci un indirizzo HTTPS Tailscale valido.");
        });
        root.addView(go);
    }

    private boolean connect(String value) {
        URI candidate;
        try { candidate = URI.create(value); }
        catch (IllegalArgumentException e) { return false; }
        String host = candidate.getHost();
        if (!"https".equalsIgnoreCase(candidate.getScheme()) || host == null
                || !host.toLowerCase(java.util.Locale.ROOT).endsWith(".ts.net")
                || candidate.getRawUserInfo() != null || candidate.getRawQuery() != null
                || (candidate.getPort() != -1 && candidate.getPort() != 443 && candidate.getPort() != 8443)
                || !(candidate.getPath().isEmpty() || candidate.getPath().equals("/"))) return false;
        closeWeb();
        server = candidate;
        getPreferences(MODE_PRIVATE).edit().putString("server", origin(candidate)).apply();
        layout();
        LinearLayout bar = new LinearLayout(this);
        Button edit = new Button(this);
        edit.setText("Server");
        edit.setOnClickListener(view -> showConnection());
        Button reload = new Button(this);
        reload.setText("Riprova");
        reload.setOnClickListener(view -> web.loadUrl(origin(server)));
        bar.addView(edit);
        bar.addView(reload);
        root.addView(bar);
        TextView connection = new TextView(this);
        connection.setText("Connessione al PC…");
        root.addView(connection);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        // This bridge can only request a native confirmation for a fixed system action.
        web.addJavascriptInterface(new PhoneActions(), "NathionPhone");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !sameOrigin(request.getUrl());
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (sameOrigin(Uri.parse(url)) && connection.getText().equals("Connessione al PC…"))
                    connection.setVisibility(android.view.View.GONE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    connection.setVisibility(android.view.View.VISIBLE);
                    connection.setText("PC non raggiungibile. Controlla Tailscale sul telefono e NATHION sul PC, poi premi Riprova.");
                }
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                connection.setText("Connessione al PC…");
                connection.setVisibility(android.view.View.VISIBLE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                if (!sameOrigin(request.getOrigin()) || !java.util.Arrays.asList(request.getResources())
                        .contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    if (pendingMicrophone != null) pendingMicrophone.deny();
                    pendingMicrophone = request;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MICROPHONE);
                }
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (request == pendingMicrophone) pendingMicrophone = null;
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        web.loadUrl(candidate.toString());
        return true;
    }

    private static int port(int value) { return value == -1 ? 443 : value; }
    private static String origin(URI uri) {
        return "https://" + uri.getHost() + (port(uri.getPort()) == 443 ? "" : ":" + uri.getPort());
    }
    private boolean sameOrigin(Uri uri) {
        return server != null && "https".equalsIgnoreCase(uri.getScheme())
                && server.getHost().equalsIgnoreCase(uri.getHost()) && port(server.getPort()) == port(uri.getPort());
    }

    public final class PhoneActions {
        @JavascriptInterface public void openSettings() {
            runOnUiThread(() -> {
                if (web == null || web.getUrl() == null || !sameOrigin(Uri.parse(web.getUrl())) || !hasWindowFocus()) return;
                new AlertDialog.Builder(MainActivity.this)
                    .setMessage("Aprire le impostazioni di Android?")
                    .setNegativeButton("Annulla", null)
                    .setPositiveButton("Apri", (dialog, which) -> startActivity(new Intent(Settings.ACTION_SETTINGS)))
                    .show();
            });
        }
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != MICROPHONE || pendingMicrophone == null) return;
        PermissionRequest request = pendingMicrophone;
        pendingMicrophone = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED && sameOrigin(request.getOrigin()))
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        else request.deny();
    }

    private void closeWeb() {
        if (pendingMicrophone != null) { pendingMicrophone.deny(); pendingMicrophone = null; }
        if (web != null) {
            web.stopLoading();
            ((ViewGroup) web.getParent()).removeView(web);
            web.destroy();
            web = null;
        }
    }

    @Override protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }
    @Override protected void onStop() {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('nathion-background'))", null);
        super.onStop();
    }

    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }
    @Override protected void onDestroy() {
        closeWeb();
        super.onDestroy();
    }
}
