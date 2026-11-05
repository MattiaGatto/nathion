package it.nathion.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.provider.DocumentsContract;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.ValueCallback;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.net.URI;

public class MainActivity extends Activity {
    private static final int MICROPHONE = 10;
    private static final int PICK_FILE = 11;
    private static final int SAVE_LOG = 12;
    private static final int MAX_EXPORT = 16 * 1024 * 1024;
    private ValueCallback<Uri[]> pendingFile;
    private byte[] pendingExport;
    private LinearLayout root;
    private WebView web;
    private PermissionRequest pendingMicrophone;
    private URI server;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(9, 15, 24));
        getWindow().setNavigationBarColor(Color.rgb(9, 15, 24));
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
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
        Button connectionMenu = new Button(this, null, android.R.attr.borderlessButtonStyle);
        connectionMenu.setText("Connessione PC  ⋯");
        connectionMenu.setAllCaps(false);
        connectionMenu.setTextSize(13);
        connectionMenu.setOnClickListener(view -> new AlertDialog.Builder(this)
            .setTitle("Connessione NATHION")
            .setMessage(origin(server))
            .setNeutralButton("Cambia PC", (dialog, which) -> showConnection())
            .setNegativeButton("Chiudi", null)
            .setPositiveButton("Ricarica", (dialog, which) -> web.loadUrl(origin(server)))
            .show());
        root.addView(connectionMenu, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, (int) (44 * getResources().getDisplayMetrics().density)));
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
        // The bridge opens system confirmation or a user-selected document destination.
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
                    connection.setText("PC non raggiungibile. Controlla Tailscale e NATHION sul PC, poi usa Connessione PC → Ricarica.");
                }
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                connection.setText("Connessione al PC…");
                connection.setVisibility(android.view.View.VISIBLE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!trustedPage() || pendingFile != null || params.getMode() != FileChooserParams.MODE_OPEN) return false;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("*/*");
                String[] types = java.util.Arrays.stream(params.getAcceptTypes())
                    .filter(type -> type.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+*-]+"))
                    .toArray(String[]::new);
                if (types.length == 1) picker.setType(types[0]);
                else if (types.length > 1) picker.putExtra(Intent.EXTRA_MIME_TYPES, types);
                try {
                    pendingFile = callback;
                    startActivityForResult(picker, PICK_FILE);
                    return true;
                } catch (ActivityNotFoundException e) {
                    pendingFile = null;
                    Toast.makeText(MainActivity.this, "Selettore file non disponibile", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
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

    private boolean trustedPage() {
        return web != null && web.getUrl() != null && sameOrigin(Uri.parse(web.getUrl()));
    }

    public final class PhoneActions {
        @JavascriptInterface public void saveActivityLog(String json) {
            if (json == null || json.length() > MAX_EXPORT) return;
            byte[] data = json.getBytes(StandardCharsets.UTF_8);
            runOnUiThread(() -> {
                if (!trustedPage() || !hasWindowFocus() || pendingExport != null) return;
                if (data.length > MAX_EXPORT) {
                    Toast.makeText(MainActivity.this, "Registro troppo grande per Android", Toast.LENGTH_LONG).show();
                    return;
                }
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, "nathion-attivita.json");
                try {
                    pendingExport = data;
                    startActivityForResult(intent, SAVE_LOG);
                } catch (ActivityNotFoundException e) {
                    pendingExport = null;
                    Toast.makeText(MainActivity.this, "Salvataggio file non disponibile", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface public void openSettings() {
            runOnUiThread(() -> {
                if (!trustedPage() || !hasWindowFocus()) return;
                new AlertDialog.Builder(MainActivity.this)
                    .setMessage("Aprire le impostazioni di Android?")
                    .setNegativeButton("Annulla", null)
                    .setPositiveButton("Apri", (dialog, which) -> startActivity(new Intent(Settings.ACTION_SETTINGS)))
                    .show();
            });
        }
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        boolean document = uri != null && "content".equals(uri.getScheme()) && DocumentsContract.isDocumentUri(this, uri);
        if (code == PICK_FILE && pendingFile != null) {
            ValueCallback<Uri[]> callback = pendingFile;
            pendingFile = null;
            callback.onReceiveValue(document && trustedPage() ? new Uri[]{uri} : null);
        } else if (code == SAVE_LOG) {
            byte[] exported = pendingExport;
            pendingExport = null;
            if (!document || exported == null) return;
            new Thread(() -> {
                boolean saved = false;
                try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output != null) { output.write(exported); saved = true; }
                } catch (Exception ignored) { saved = false; }
                final boolean success = saved;
                runOnUiThread(() -> Toast.makeText(this, success ? "Registro salvato" : "Salvataggio non riuscito", Toast.LENGTH_SHORT).show());
            }, "nathion-export").start();
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
        if (pendingFile != null) { pendingFile.onReceiveValue(null); pendingFile = null; }
        pendingExport = null;
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
