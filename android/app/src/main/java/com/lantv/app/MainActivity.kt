package com.lantv.app

import android.app.AlertDialog
import android.os.Bundle
import android.text.InputType
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ProgressBar
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

private const val PREFS = "lantv_prefs"
private const val KEY_SERVER_URL = "server_url"
private const val DEFAULT_URL = "http://192.168.29.157:8000"

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var progress: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Keep the screen on while this is running -- it's meant to behave like a TV.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = findViewById(R.id.webview)
        progress = findViewById(R.id.progress)

        setupWebView()

        findViewById<ImageButton>(R.id.btnSettings).setOnClickListener {
            showServerDialog()
        }

        val savedUrl = prefs().getString(KEY_SERVER_URL, null)
        if (savedUrl.isNullOrBlank()) {
            showServerDialog(firstRun = true)
        } else {
            webView.loadUrl(savedUrl)
        }
    }

    private fun prefs() = getSharedPreferences(PREFS, MODE_PRIVATE)

    private fun setupWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.visibility = if (newProgress >= 100) android.view.View.GONE else android.view.View.VISIBLE
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView,
                errorCode: Int,
                description: String?,
                failingUrl: String?
            ) {
                Toast.makeText(
                    this@MainActivity,
                    "Can't reach LanTv server. Tap the gear icon to check the address.",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    private fun showServerDialog(firstRun: Boolean = false) {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setText(prefs().getString(KEY_SERVER_URL, null) ?: DEFAULT_URL)
            setSelection(text.length)
        }

        val message = if (firstRun) {
            "Enter your LanTv server address. You'll find it printed in the terminal when " +
                "the server starts (the \".local\" link is best, since it survives WiFi/IP changes)."
        } else {
            "Update the LanTv server address."
        }

        AlertDialog.Builder(this)
            .setTitle("LanTv server")
            .setMessage(message)
            .setView(input)
            .setCancelable(!firstRun)
            .setPositiveButton("Connect") { _, _ ->
                var url = input.text.toString().trim()
                if (url.isEmpty()) url = DEFAULT_URL
                if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    url = "http://$url"
                }
                prefs().edit().putString(KEY_SERVER_URL, url).apply()
                webView.loadUrl(url)
            }
            .show()
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
