package com.carewell.mobile

import org.json.JSONArray
import org.json.JSONObject
import java.net.CookieManager
import java.net.CookiePolicy
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Small native HTTP client for the same versioned API used by the Carewell website. */
object CarewellApi {
    private const val BASE_URL = "https://carewell-psi.vercel.app/api/v1"
    private val cookies = CookieManager(null, CookiePolicy.ACCEPT_ALL)

    data class ApiFailure(val status: Int, override val message: String) : Exception(message)

    fun get(path: String): Any? = request("GET", path)
    fun post(path: String, body: JSONObject): Any? = request("POST", path, body)
    fun patch(path: String, body: JSONObject): Any? = request("PATCH", path, body)

    private fun request(method: String, path: String, body: JSONObject? = null): Any? {
        val connection = URL(BASE_URL + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 15_000
        connection.readTimeout = 20_000
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("X-Language", "en")
        cookies.getCookieStore().get(URL(BASE_URL).toURI()).joinToString("; ") { "${it.name}=${it.value}" }
            .takeIf { it.isNotEmpty() }?.let { connection.setRequestProperty("Cookie", it) }
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        }
        val headers = mutableMapOf<String, List<String>>()
        connection.headerFields.forEach { (key, values) ->
            if (key != null && values != null) headers[key] = values.filterNotNull()
        }
        cookies.put(URL(BASE_URL).toURI(), headers)
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        val status = connection.responseCode
        connection.disconnect()
        if (status !in 200..299) {
            val message = runCatching { JSONObject(text).optString("message") }.getOrNull()
                ?.takeIf { it.isNotBlank() } ?: "Request failed ($status)."
            throw ApiFailure(status, message)
        }
        if (text.isBlank()) return null
        return if (text.trimStart().startsWith("[")) JSONArray(text) else JSONObject(text)
    }

    fun query(path: String, values: Map<String, String>): String = path + values.entries
        .filter { it.value.isNotBlank() }
        .joinToString("&", prefix = "?") {
            "${URLEncoder.encode(it.key, "UTF-8")}=${URLEncoder.encode(it.value, "UTF-8")}"
        }
}

