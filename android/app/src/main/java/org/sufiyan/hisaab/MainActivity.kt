package org.sufiyan.hisaab

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewAssetLoader.AssetsPathHandler
import org.sufiyan.hisaab.bridge.AndroidBridge
import org.sufiyan.hisaab.service.HisaabNotificationService

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var assetLoader: WebViewAssetLoader

    private var pendingAction: String? = null
    private var backPressedOnce = false
    private var backToastTimer: Runnable? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Enable hardware acceleration
        window.setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        )

        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)

        // Notification channel initialization
        HisaabNotificationService.createNotificationChannel(this)

        // Set up secure local asset loader for zero-latency offline loading
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", AssetsPathHandler(this))
            .build()

        configureWebView()
        setupBackHandler()

        handleIntentAction(intent)

        // Load Hisaab root
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntentAction(intent)
    }

    private fun handleIntentAction(intent: Intent?) {
        val action = intent?.getStringExtra("action") ?: return
        pendingAction = action
        dispatchPendingActionIfReady()
    }

    private fun dispatchPendingActionIfReady() {
        val action = pendingAction ?: return
        val js = "if (typeof window.hisaabAction === 'function') { window.hisaabAction('$action'); }"
        webView.post {
            webView.evaluateJavascript(js, null)
            pendingAction = null
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.setBackgroundColor(Color.parseColor("#0E141B"))
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mediaPlaybackRequiresUserGesture = false
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true

        // Register the native Kotlin bridge
        webView.addJavascriptInterface(AndroidBridge(this, webView), "AndroidBridge")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress >= 100) {
                    progressBar.visibility = View.GONE
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                request?.url?.let { uri ->
                    val response = assetLoader.shouldInterceptRequest(uri)
                    if (response != null) return response
                }
                return super.shouldInterceptRequest(view, request)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                // Keep local app pages inside webview
                if (url.startsWith("https://appassets.androidplatform.net")) {
                    return false
                }
                // Open external links in system browser
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    true
                } catch (_: Exception) {
                    false
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
                dispatchPendingActionIfReady()
            }
        }
    }

    private fun setupBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // First: Check if a sheet, modal, or drawer is open in the Web UI
                webView.evaluateJavascript(
                    "(function() { if (document.querySelector('.sheet.open') || document.querySelector('.modal-backdrop') || document.querySelector('#lock')) { if (window.closeSheet) { window.closeSheet(); return true; } } return false; })()"
                ) { result ->
                    val sheetClosed = result == "true"
                    if (!sheetClosed) {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            handleDoubleTapExit()
                        }
                    }
                }
            }
        })
    }

    private fun handleDoubleTapExit() {
        if (backPressedOnce) {
            finish()
            return
        }
        backPressedOnce = true
        Toast.makeText(this, "Press back again to exit Hisaab", Toast.LENGTH_SHORT).show()
        backToastTimer?.let { webView.removeCallbacks(it) }
        backToastTimer = Runnable { backPressedOnce = false }
        webView.postDelayed(backToastTimer!!, 2000)
    }

    /**
     * Shows native Android OS BiometricPrompt dialog.
     * Directly interacts with hardware fingerprint sensor without webauthn passkey redirection.
     */
    fun showBiometricPrompt(reason: String, onResult: (Boolean) -> Unit) {
        val executor = ContextCompat.getMainExecutor(this)
        val prompt = BiometricPrompt(this, executor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                super.onAuthenticationSucceeded(result)
                onResult(true)
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                super.onAuthenticationError(errorCode, errString)
                onResult(false)
            }

            override fun onAuthenticationFailed() {
                super.onAuthenticationFailed()
                // Keep dialog open for another fingerprint scan
            }
        })

        val title = getString(R.string.bio_prompt_title)
        val subtitle = if (reason.isNotBlank()) reason else getString(R.string.bio_prompt_subtitle)
        val negative = getString(R.string.bio_prompt_cancel)

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setNegativeButtonText(negative)
            .build()

        prompt.authenticate(promptInfo)
    }
}
