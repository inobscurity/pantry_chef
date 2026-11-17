package com.pantrychef.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray

/**
 * Pantry Chef as an Android app.
 *
 * The main view shows the Pantry Chef website, so the app always has its latest version. Links to
 * other sites (the recipe searches, a recipe's original page) open in a built-in browser laid over
 * it, with a "Save to Pantry Chef" button. The button runs the website's own recipe reader
 * (MyRecipes.extractorCode()) on the page being viewed, and hands what it read back to Pantry Chef
 * (window.PantryChefSave), which keeps it in My recipes.
 */
class MainActivity : Activity() {

    private lateinit var app: WebView
    private lateinit var browser: WebView
    private lateinit var browserPanel: LinearLayout
    private lateinit var browserTitle: TextView
    private lateinit var saveButton: Button

    /** The recipe reader, as code, read from the Pantry Chef website once it has loaded. */
    private var extractor: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        app = WebView(this)
        app.settings.javaScriptEnabled = true
        app.settings.domStorageEnabled = true
        app.settings.setSupportMultipleWindows(true)
        // Only the Pantry Chef pages get this bridge: it lets them open links in the app's browser.
        app.addJavascriptInterface(Bridge(), "PantryChefAndroid")
        app.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (isPantryChef(url)) return false
                openBrowser(url.toString())
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript("window.MyRecipes ? window.MyRecipes.extractorCode() : null") { result ->
                    if (result != null && result != "null") extractor = jsString(result)
                }
            }
        }
        app.webChromeClient = object : WebChromeClient() {
            // A link that opens a new window (target="_blank") goes to the app's browser instead.
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                val catcher = WebView(this@MainActivity)
                catcher.webViewClient = object : WebViewClient() {
                    private var done = false
                    private fun take(v: WebView, url: String) {
                        if (done) return
                        done = true
                        v.stopLoading()
                        openBrowser(url)
                    }
                    override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                        take(v, request.url.toString())
                        return true
                    }
                    override fun onPageStarted(v: WebView, url: String, favicon: android.graphics.Bitmap?) {
                        take(v, url)
                    }
                }
                (resultMsg.obj as WebView.WebViewTransport).webView = catcher
                resultMsg.sendToTarget()
                return true
            }
        }

        browser = WebView(this)
        browser.settings.javaScriptEnabled = true
        browser.settings.domStorageEnabled = true
        browser.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.scheme == "http" || url.scheme == "https") {
                    if (isPantryChef(url)) {
                        closeBrowser()
                        app.loadUrl(url.toString())
                        return true
                    }
                    return false
                }
                // mailto:, tel:, intent: and the like go to the phone's other apps.
                try { startActivity(Intent(Intent.ACTION_VIEW, url)) } catch (_: Exception) {}
                return true
            }
        }
        browser.webChromeClient = object : WebChromeClient() {
            override fun onReceivedTitle(view: WebView, title: String?) {
                browserTitle.text = title ?: ""
            }
        }

        browserPanel = buildBrowserPanel()
        browserPanel.visibility = View.GONE

        val root = FrameLayout(this)
        root.addView(app, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        root.addView(browserPanel, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        setContentView(root)

        if (savedInstanceState != null) app.restoreState(savedInstanceState) else app.loadUrl(APP_URL)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        app.saveState(outState)
    }

    /** The browser: a bar with the page title and Close, the page, and the Save button. */
    private fun buildBrowserPanel(): LinearLayout {
        val dp = resources.displayMetrics.density
        val panel = LinearLayout(this)
        panel.orientation = LinearLayout.VERTICAL
        panel.setBackgroundColor(Color.WHITE)

        val bar = LinearLayout(this)
        bar.orientation = LinearLayout.HORIZONTAL
        bar.gravity = Gravity.CENTER_VERTICAL
        bar.setBackgroundColor(ACCENT)
        bar.setPadding((12 * dp).toInt(), 0, 0, 0)
        browserTitle = TextView(this)
        browserTitle.setTextColor(Color.WHITE)
        browserTitle.textSize = 15f
        browserTitle.maxLines = 1
        browserTitle.ellipsize = android.text.TextUtils.TruncateAt.END
        bar.addView(browserTitle, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        val close = Button(this, null, android.R.attr.borderlessButtonStyle)
        close.text = "Close"
        close.setTextColor(Color.WHITE)
        close.setOnClickListener { closeBrowser() }
        bar.addView(close, LinearLayout.LayoutParams(WRAP_CONTENT, (48 * dp).toInt()))
        panel.addView(bar, LinearLayout.LayoutParams(MATCH_PARENT, (48 * dp).toInt()))

        panel.addView(browser, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))

        saveButton = Button(this)
        saveButton.text = "Save to Pantry Chef"
        saveButton.setTypeface(saveButton.typeface, Typeface.BOLD)
        saveButton.setTextColor(Color.WHITE)
        saveButton.setBackgroundColor(ACCENT)
        saveButton.setOnClickListener { saveRecipe() }
        panel.addView(saveButton, LinearLayout.LayoutParams(MATCH_PARENT, (56 * dp).toInt()))
        return panel
    }

    private fun openBrowser(url: String) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return
        browserTitle.text = ""
        browser.loadUrl(url)
        browserPanel.visibility = View.VISIBLE
    }

    private fun closeBrowser() {
        browserPanel.visibility = View.GONE
        browser.loadUrl("about:blank")
    }

    /** Reads the recipe on the page in the browser and gives it to Pantry Chef. */
    private fun saveRecipe() {
        val code = extractor
        if (code == null) {
            Toast.makeText(this, "Pantry Chef is still loading. Try again in a moment.", Toast.LENGTH_SHORT).show()
            return
        }
        browser.evaluateJavascript(code) { result ->
            val json = if (result == null || result == "null") "" else jsString(result)
            if (json.isEmpty()) {
                Toast.makeText(this, "No recipe found on this page.", Toast.LENGTH_LONG).show()
                return@evaluateJavascript
            }
            // `result` is the JSON as a JavaScript string literal, so this passes it on unchanged.
            app.evaluateJavascript("window.PantryChefSave && window.PantryChefSave(JSON.parse($result))") { ok ->
                if (ok == "true") {
                    Toast.makeText(this, "Saved to My recipes", Toast.LENGTH_SHORT).show()
                    closeBrowser()
                } else {
                    Toast.makeText(this, "That recipe couldn't be saved.", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    @Deprecated("Back still comes here for this simple app")
    override fun onBackPressed() {
        when {
            browserPanel.visibility == View.VISIBLE && browser.canGoBack() -> browser.goBack()
            browserPanel.visibility == View.VISIBLE -> closeBrowser()
            app.canGoBack() -> app.goBack()
            else -> @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    /** Called from the Pantry Chef pages. */
    inner class Bridge {
        @JavascriptInterface
        fun openBrowser(url: String) {
            runOnUiThread { this@MainActivity.openBrowser(url) }
        }
    }

    private fun isPantryChef(url: Uri): Boolean =
        url.host == APP_HOST && (url.path ?: "").startsWith(APP_PATH)

    /** A JavaScript string literal (as evaluateJavascript returns it) as plain text. */
    private fun jsString(literal: String): String =
        try { JSONArray("[$literal]").optString(0, "") } catch (_: Exception) { "" }

    companion object {
        private const val APP_HOST = "inobscurity.github.io"
        private const val APP_PATH = "/pantry_chef"
        private const val APP_URL = "https://$APP_HOST$APP_PATH/"
        private val ACCENT = Color.parseColor("#C2410C")
    }
}
