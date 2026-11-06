package it.nathion.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Base64;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final int MICROPHONE = 10;
    private static final int PICK_FILE = 11;
    private static final int SAVE_LOG = 12;
    private static final int NATIVE_MICROPHONE = 13;
    private static final int SAMPLE_RATE = 16000;
    private final ExecutorService microphoneWorker = Executors.newSingleThreadExecutor();
    private volatile int recordingSession;
    private int pendingNativeSession;
    private static final String TAILSCALE_PACKAGE = "com.tailscale.ipn";
    private static final int SURFACE = 0xff111c2d;
    private static final int CYAN = 0xffa3eaff;
    private static final int MUTED = 0xffaabed2;
    private static final int MAX_EXPORT = 16 * 1024 * 1024;
    private ValueCallback<Uri[]> pendingFile;
    private byte[] pendingExport;
    private LinearLayout root;
    private WebView web;
    private PermissionRequest pendingMicrophone;
    private URI server;
    private boolean reloadAfterTailscale;
    private boolean resumed;
    private boolean pausedRecording;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(9, 15, 24));
        getWindow().setNavigationBarColor(Color.rgb(9, 15, 24));
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        String saved = getPreferences(MODE_PRIVATE).getString("server", "");
        if (saved.isEmpty()) showConnection();
        else if (!connect(saved)) showConnection();
    }

    private void layout() {
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(12, 17, 24));
        setContentView(root);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable pill(int color, int border) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(color);
        background.setCornerRadius(dp(12));
        background.setStroke(dp(1), border);
        return background;
    }

    private Button control(String label, int color, Runnable action) {
        Button button = new Button(this, null, android.R.attr.borderlessButtonStyle);
        button.setText(label);
        button.setTextColor(color);
        button.setTextSize(13);
        button.setAllCaps(false);
        button.setMinWidth(0);
        button.setPadding(dp(4), 0, dp(4), 0);
        button.setBackground(pill(SURFACE, 0xff304762));
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private void networkControls(boolean connected) {
        LinearLayout row = new LinearLayout(this);
        row.setPadding(dp(8), dp(6), dp(8), dp(6));
        if (connected) addControl(row, control("PC  ⋯", CYAN, this::connectionOptions));
        addControl(row, control("Apri Tailscale", CYAN, this::openTailscale));
        addControl(row, control("Disconnetti VPN", 0xffffbf9d, this::disconnectTailscale));
        root.addView(row);
    }

    private void addControl(LinearLayout row, Button button) {
        LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(0, dp(48), 1);
        size.setMargins(dp(3), 0, dp(3), 0);
        row.addView(button, size);
    }

    private void connectionOptions() {
        new AlertDialog.Builder(this)
            .setTitle("Connessione al PC")
            .setItems(new String[]{"Ricarica", "Cambia PC", "Chiudi NATHION"}, (dialog, which) -> {
                if (which == 0 && web != null) web.loadUrl(origin(server));
                if (which == 1) showConnection();
                if (which == 2) finishAndRemoveTask();
            })
            .setNegativeButton("Indietro", null)
            .show();
    }

    private void openTailscale() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(TAILSCALE_PACKAGE);
        if (launch == null) {
            Toast.makeText(this, "Installa Tailscale dal Play Store.", Toast.LENGTH_LONG).show();
            return;
        }
        try {
            reloadAfterTailscale = web != null;
            startActivity(launch);
        } catch (ActivityNotFoundException e) {
            reloadAfterTailscale = false;
            Toast.makeText(this, "Tailscale non è disponibile.", Toast.LENGTH_SHORT).show();
        }
    }

    private void disconnectTailscale() {
        Intent disconnect = new Intent(TAILSCALE_PACKAGE + ".DISCONNECT_VPN").setPackage(TAILSCALE_PACKAGE);
        if (getPackageManager().queryBroadcastReceivers(disconnect, 0).isEmpty()) {
            Toast.makeText(this, "Disattiva la VPN direttamente in Tailscale.", Toast.LENGTH_LONG).show();
            openTailscale();
            return;
        }
        new AlertDialog.Builder(this)
            .setTitle("Disconnettere Tailscale?")
            .setMessage("Il telefono perderà l’accesso a NATHION e agli altri servizi della rete privata.")
            .setNegativeButton("Annulla", null)
            .setPositiveButton("Disconnetti", (dialog, which) -> {
                if (web != null) {
                    web.evaluateJavascript("window.dispatchEvent(new Event('nathion-background'))", null);
                    web.stopLoading();
                }
                sendBroadcast(disconnect);
                Toast.makeText(this, "Disconnessione richiesta a Tailscale", Toast.LENGTH_SHORT).show();
                showConnection();
            })
            .show();
    }

    private void showConnection() {
        closeWeb();
        layout();
        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(20), dp(22), dp(20), dp(18));
        card.setBackground(pill(SURFACE, 0xff304762));
        LinearLayout frame = new LinearLayout(this);
        frame.setPadding(dp(16), dp(20), dp(16), dp(16));
        frame.addView(card, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        scroll.addView(frame);
        networkControls(false);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        TextView eyebrow = new TextView(this);
        eyebrow.setText("NATHION  ·  RETE PRIVATA");
        eyebrow.setTextColor(CYAN);
        eyebrow.setTextSize(12);
        eyebrow.setLetterSpacing(.12f);
        card.addView(eyebrow);
        TextView title = new TextView(this);
        title.setText("Connetti il tuo PC");
        title.setTextColor(0xfff0f6ff);
        title.setTextSize(25);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setPadding(0, dp(8), 0, dp(8));
        card.addView(title);
        TextView intro = new TextView(this);
        intro.setText("Apri Tailscale e attiva la VPN. Poi torna qui e accedi al tuo assistente.");
        intro.setTextColor(MUTED);
        intro.setTextSize(14);
        card.addView(intro);
        EditText address = new EditText(this);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setSingleLine(true);
        address.setTextSize(14);
        address.setPadding(dp(10), 0, dp(10), 0);
        address.setBackground(pill(0xff0b1422, 0xff385370));
        address.setHint("https://nome-pc.rete.ts.net:8443");
        int configuredHost = getResources().getIdentifier("private_host", "string", getPackageName());
        String preset = configuredHost == 0 ? "" : getString(configuredHost);
        address.setText(getPreferences(MODE_PRIVATE).getString("server", preset));
        LinearLayout.LayoutParams field = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        field.setMargins(0, dp(16), 0, dp(10));
        card.addView(address, field);
        Button go = control("Connetti al PC", CYAN, () -> {
            if (!connect(address.getText().toString().trim())) address.setError("Inserisci un indirizzo HTTPS Tailscale valido.");
        });
        card.addView(go, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
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
        networkControls(true);
        TextView connection = new TextView(this);
        connection.setText("Connessione privata al PC…");
        connection.setTextColor(MUTED);
        connection.setPadding(dp(12), dp(8), dp(12), dp(8));
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
                if (sameOrigin(Uri.parse(url)) && connection.getText().equals("Connessione privata al PC…"))
                    connection.setVisibility(android.view.View.GONE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    connection.setVisibility(android.view.View.VISIBLE);
                    connection.setText("PC non raggiungibile. Apri Tailscale, attiva la VPN e torna qui. Puoi riprovare da PC → Ricarica.");
                }
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                recordingSession = 0;
                pendingNativeSession = 0;
                connection.setText("Connessione privata al PC…");
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
                if (pendingMicrophone != null) pendingMicrophone.deny();
                pendingMicrophone = request;
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    grantPendingMicrophone();
                } else {
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

    private void microphoneEvent(int session, String type, String pcm, String message) {
        if (recordingSession != session || !resumed || !trustedPage()) return;
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('nathion-native-audio',{detail:{session:"
            + session + ",type:" + JSONObject.quote(type) + ",pcm:" + JSONObject.quote(pcm)
            + ",message:" + JSONObject.quote(message) + "}}))", null);
    }

    private void startPendingRecording() {
        if (!resumed || pendingNativeSession == 0 || !trustedPage()) return;
        int session = pendingNativeSession;
        pendingNativeSession = 0;
        recordingSession = session;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            microphoneEvent(session, "error", "", "Consenti il microfono nelle impostazioni di NATHION.");
            recordingSession = 0;
            return;
        }
        microphoneWorker.execute(() -> recordMicrophone(session));
    }

    private AudioRecord openRecorder(int source) {
        int minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minimum <= 0) throw new IllegalStateException("Audio format unavailable");
        AudioRecord recorder = new AudioRecord(source, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum, 4096));
        try {
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("Audio source unavailable");
            recorder.startRecording();
            if (recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IllegalStateException("Audio source stopped");
            return recorder;
        } catch (RuntimeException e) {
            recorder.release();
            throw e;
        }
    }

    private void recordMicrophone(int session) {
        if (recordingSession != session) return;
        AudioRecord recorder = null;
        try {
            try {
                recorder = openRecorder(MediaRecorder.AudioSource.VOICE_RECOGNITION);
            } catch (RuntimeException e) {
                recorder = openRecorder(MediaRecorder.AudioSource.MIC);
            }
            runOnUiThread(() -> microphoneEvent(session, "ready", "", ""));
            // 64 ms of little-endian PCM per message, without files or storage.
            byte[] pcm = new byte[2048];
            while (recordingSession == session) {
                int count = recorder.read(pcm, 0, pcm.length, AudioRecord.READ_BLOCKING);
                if (count < 0) throw new IllegalStateException("Audio read failed");
                if (count == 0) continue;
                String encoded = Base64.encodeToString(pcm, 0, count, Base64.NO_WRAP);
                runOnUiThread(() -> microphoneEvent(session, "frame", encoded, ""));
            }
        } catch (RuntimeException e) {
            runOnUiThread(() -> {
                microphoneEvent(session, "error", "", "Android non riesce ad aprire il microfono. Controlla il permesso di NATHION e l’accesso al microfono nelle impostazioni rapide.");
                if (recordingSession == session) recordingSession = 0;
            });
        } finally {
            if (recorder != null) {
                try { recorder.stop(); } catch (IllegalStateException ignored) {}
                recorder.release();
            }
        }
    }

    public final class PhoneActions {
        @JavascriptInterface public void startMicrophone(int session) {
            runOnUiThread(() -> {
                if (session <= 0 || !trustedPage() || !resumed) return;
                pendingNativeSession = session;
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    startPendingRecording();
                } else {
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, NATIVE_MICROPHONE);
                }
            });
        }

        @JavascriptInterface public void stopMicrophone(int session) {
            runOnUiThread(() -> {
                if (pendingNativeSession == session) pendingNativeSession = 0;
                if (recordingSession == session) recordingSession = 0;
            });
        }

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
        if (code == NATIVE_MICROPHONE) {
            startPendingRecording();
            return;
        }
        if (code != MICROPHONE || pendingMicrophone == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            grantPendingMicrophone();
        } else {
            pendingMicrophone.deny();
            pendingMicrophone = null;
        }
    }

    private void grantPendingMicrophone() {
        if (!resumed || pendingMicrophone == null
                || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return;
        PermissionRequest request = pendingMicrophone;
        pendingMicrophone = null;
        if (sameOrigin(request.getOrigin())) request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        else request.deny();
    }

    private void closeWeb() {
        recordingSession = 0;
        pendingNativeSession = 0;
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
        resumed = false;
        pausedRecording = recordingSession != 0;
        recordingSession = 0;
        if (web != null) web.onPause();
        super.onPause();
    }
    @Override protected void onStop() {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('nathion-background'))", null);
        super.onStop();
    }

    @Override protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            if (pausedRecording) web.evaluateJavascript("window.dispatchEvent(new Event('nathion-background'))", null);
            if (reloadAfterTailscale) web.loadUrl(origin(server));
        }
        reloadAfterTailscale = false;
        pausedRecording = false;
        resumed = true;
        grantPendingMicrophone();
        startPendingRecording();
    }
    @Override protected void onDestroy() {
        closeWeb();
        microphoneWorker.shutdown();
        super.onDestroy();
    }
}
