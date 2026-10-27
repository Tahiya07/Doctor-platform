package com.carewell.mobile

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import java.io.ByteArrayInputStream

/** Runs the repository's built React app locally, preserving its exact UI and API flows. */
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var fileChooserCallback: android.webkit.ValueCallback<Array<Uri>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.setDecorFitsSystemWindows(true)
        window.statusBarColor = Color.rgb(7, 17, 31)
        window.navigationBarColor = Color.rgb(7, 17, 31)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            webViewClient = CarewellWebViewClient()
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView?,
                    callback: android.webkit.ValueCallback<Array<Uri>>?,
                    params: FileChooserParams?,
                ): Boolean {
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = callback
                    val picker = params?.createIntent() ?: Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                    }
                    return try {
                        startActivityForResult(picker, FILE_PICKER_REQUEST)
                        true
                    } catch (_: Exception) {
                        fileChooserCallback = null
                        false
                    }
                }
            }
            setDownloadListener { url, _, _, _, _ -> openExternal(url) }
        }
        setContentView(webView)
        webView.loadUrl(appUrl(intent))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (::webView.isInitialized) webView.loadUrl(appUrl(intent))
    }

    @Deprecated("WebView file picker callback")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != FILE_PICKER_REQUEST) return
        val result = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
        fileChooserCallback?.onReceiveValue(result)
        fileChooserCallback = null
    }

    @Deprecated("Activity back callback")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        if (::webView.isInitialized) {
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun appUrl(launchIntent: Intent?): String {
        val incoming = launchIntent?.data
        if (incoming?.scheme == "https" && incoming.host == APP_HOST && !incoming.fragment.isNullOrBlank()) {
            return "$APP_ORIGIN/#${incoming.fragment}"
        }
        return "$APP_ORIGIN/"
    }

    private fun openExternal(address: String) {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(address))) }
    }

    private inner class CarewellWebViewClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
            val uri = request?.url ?: return null
            if (uri.scheme != "https" || uri.host != APP_HOST) return null
            val path = Uri.decode(uri.path.orEmpty()).ifBlank { "/" }
            // API calls go to the same Vercel origin as the hosted site, retaining its proxy,
            // cookies, CSRF protection, and backend behavior without cross-origin workarounds.
            if (path == "/api" || path.startsWith("/api/")) return null
            val relative = path.removePrefix("/").takeIf { it.isNotBlank() } ?: "index.html"
            val assetPath = "web/$relative"
            val stream = runCatching { assets.open(assetPath) }.getOrElse {
                if (request.method.equals("GET", true) && !relative.contains('.')) runCatching { assets.open("web/index.html") }.getOrNull()
                else null
            } ?: return notFound()
            val extension = relative.substringAfterLast('.', "html").lowercase()
            val mime = when (extension) {
                "js", "mjs" -> "text/javascript"
                "css" -> "text/css"
                "svg" -> "image/svg+xml"
                "woff" -> "font/woff"
                "woff2" -> "font/woff2"
                "ttf" -> "font/ttf"
                "json", "webmanifest" -> "application/json"
                else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "application/octet-stream"
            }
            return WebResourceResponse(mime, "UTF-8", stream)
        }

        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            val uri = request?.url ?: return false
            if (uri.scheme == "https" && uri.host == APP_HOST) return false
            if (uri.scheme == "http" || uri.scheme == "https" || uri.scheme == "mailto" || uri.scheme == "tel") {
                openExternal(uri.toString())
                return true
            }
            return false
        }
    }

    private fun notFound() = WebResourceResponse(
        "text/plain",
        "UTF-8",
        404,
        "Not Found",
        mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream(ByteArray(0)),
    )

    companion object {
        private const val APP_HOST = "carewell-psi.vercel.app"
        private const val APP_ORIGIN = "https://carewell-psi.vercel.app"
        private const val FILE_PICKER_REQUEST = 1004
    }
}
