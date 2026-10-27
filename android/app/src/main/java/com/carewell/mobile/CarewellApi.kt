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
    private var appContext: android.content.Context? = null

    @Synchronized fun init(context: android.content.Context) {
        if(appContext!=null)return
        appContext=context.applicationContext
        val stored=appContext?.getSharedPreferences("carewell_session",android.content.Context.MODE_PRIVATE)?.getString("set_cookie",null)
        if(!stored.isNullOrBlank())runCatching{cookies.put(URL(BASE_URL).toURI(),mapOf("Set-Cookie" to listOf(stored)))}
    }

    data class ApiFailure(val status: Int, override val message: String) : Exception(message)

    fun get(path: String): Any? = request("GET", path)
    fun post(path: String, body: JSONObject): Any? = request("POST", path, body)
    fun patch(path: String, body: JSONObject): Any? = request("PATCH", path, body)
    fun delete(path: String): Any? = request("DELETE", path)

    fun upload(path: String, fileName: String, mimeType: String, bytes: ByteArray, fields: Map<String,String>): Any? {
        val boundary="Carewell-${System.nanoTime()}"
        val connection=URL(BASE_URL+path).openConnection() as HttpURLConnection
        connection.requestMethod="POST";connection.connectTimeout=20_000;connection.readTimeout=30_000;connection.doOutput=true
        connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("X-Language","en")
        cookies.getCookieStore().get(URL(BASE_URL).toURI()).joinToString("; "){ "${it.name}=${it.value}" }.takeIf{it.isNotEmpty()}?.let{connection.setRequestProperty("Cookie",it)}
        connection.setRequestProperty("Content-Type","multipart/form-data; boundary=$boundary")
        connection.outputStream.use { out ->
            fields.forEach { (key,value) ->
                out.write("--$boundary\r\nContent-Disposition: form-data; name=\"$key\"\r\n\r\n$value\r\n".toByteArray())
            }
            out.write("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"${fileName.replace("\"", "") }\"\r\nContent-Type: $mimeType\r\n\r\n".toByteArray())
            out.write(bytes);out.write("\r\n--$boundary--\r\n".toByteArray())
        }
        val headers=mutableMapOf<String,List<String>>();connection.headerFields.forEach{(key,values)->if(key!=null&&values!=null)headers[key]=values.filterNotNull()};cookies.put(URL(BASE_URL).toURI(),headers);persistSession(headers)
        val status=connection.responseCode;val stream=if(status in 200..299)connection.inputStream else connection.errorStream;val text=stream?.bufferedReader()?.use{it.readText()}.orEmpty();connection.disconnect()
        if(status !in 200..299)throw ApiFailure(status,runCatching{JSONObject(text).optString("message")}.getOrNull()?.takeIf{it.isNotBlank()}?:"Upload failed ($status).")
        return if(text.isBlank())null else JSONObject(text)
    }

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
        persistSession(headers)
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

    private fun persistSession(headers:Map<String,List<String>>) {
        val values=headers.filterKeys{it.equals("Set-Cookie",true)}.values.flatten()
        val session=values.firstOrNull{it.startsWith("carewell_session=")} ?: return
        val prefs=appContext?.getSharedPreferences("carewell_session",android.content.Context.MODE_PRIVATE)?:return
        if(session.substringBefore(';').endsWith("="))prefs.edit().remove("set_cookie").apply()
        else prefs.edit().putString("set_cookie",session).apply()
    }

    fun query(path: String, values: Map<String, String>): String = path + values.entries
        .filter { it.value.isNotBlank() }
        .joinToString("&", prefix = "?") {
            "${URLEncoder.encode(it.key, "UTF-8")}=${URLEncoder.encode(it.value, "UTF-8")}"
        }
}
