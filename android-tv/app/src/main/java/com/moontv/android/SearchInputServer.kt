package com.moontv.android

import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.ServerSocket
import java.net.URLDecoder
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Lightweight HTTP server on the TV that receives search keywords from a phone browser.
 * Phone scans QR → opens browser → types keyword → POST to TV → TV searches.
 */
class SearchInputServer(
    private val onKeywordReceived: (String) -> Unit
) {
    private var serverSocket: ServerSocket? = null
    private val running = AtomicBoolean(false)
    var port: Int = 0
        private set

    fun start() {
        if (running.get()) return
        running.set(true)

        serverSocket = ServerSocket(0)
        port = serverSocket!!.localPort

        Thread {
            while (running.get()) {
                try {
                    val socket = serverSocket?.accept() ?: break
                    Thread {
                        try {
                            val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                            val writer = PrintWriter(socket.getOutputStream(), true)

                            val requestLine = reader.readLine() ?: ""
                            val headers = mutableMapOf<String, String>()
                            var line = reader.readLine()
                            while (line != null && line.isNotEmpty()) {
                                val parts = line.split(": ", limit = 2)
                                if (parts.size == 2) headers[parts[0].lowercase()] = parts[1]
                                line = reader.readLine()
                            }

                            when {
                                requestLine.startsWith("GET /search") -> {
                                    sendSearchPage(writer)
                                }
                                requestLine.startsWith("POST /search") -> {
                                    val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
                                    val body = CharArray(contentLength)
                                    reader.read(body, 0, contentLength)
                                    val bodyStr = String(body)
                                    val keyword = parseKeyword(bodyStr)
                                    if (keyword.isNotBlank()) {
                                        onKeywordReceived(keyword)
                                        sendSuccessPage(writer, keyword)
                                    } else {
                                        sendSearchPage(writer, "请输入搜索关键词")
                                    }
                                }
                                else -> {
                                    sendResponse(writer, "404 Not Found", "<h1>Not Found</h1>")
                                }
                            }

                            socket.close()
                        } catch (_: Exception) {
                            try { socket.close() } catch (_: Exception) {}
                        }
                    }.start()
                } catch (_: Exception) {
                    if (!running.get()) break
                }
            }
        }.start()
    }

    fun stop() {
        running.set(false)
        try { serverSocket?.close() } catch (_: Exception) {}
        serverSocket = null
    }

    private fun parseKeyword(body: String): String {
        val params = body.split("&")
        for (param in params) {
            val kv = param.split("=", limit = 2)
            if (kv.size == 2 && kv[0] == "keyword") {
                return URLDecoder.decode(kv[1], "UTF-8").trim()
            }
        }
        return ""
    }

    private fun sendResponse(writer: PrintWriter, status: String, html: String) {
        val bytes = html.toByteArray(Charsets.UTF_8)
        writer.print("HTTP/1.1 $status\r\n")
        writer.print("Content-Type: text/html; charset=utf-8\r\n")
        writer.print("Content-Length: ${bytes.size}\r\n")
        writer.print("Connection: close\r\n")
        writer.print("\r\n")
        writer.flush()
        writer.write(html)
        writer.flush()
    }

    private fun sendSearchPage(writer: PrintWriter, error: String? = null) {
        val errorHtml = if (error != null) {
            "<div style='color:#ef4444;margin-bottom:16px;font-size:14px;'>$error</div>"
        } else ""

        val html = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MoonTV 搜索</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:#111827;color:#f3f4f6;
display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
.card{background:#1f2937;border-radius:16px;padding:32px;max-width:400px;width:100%}
h1{color:#22c55e;font-size:24px;margin-bottom:8px;text-align:center}
p{color:#9ca3af;font-size:14px;margin-bottom:24px;text-align:center}
label{display:block;color:#d1d5db;font-size:14px;margin-bottom:8px}
input{width:100%;padding:14px 16px;border-radius:8px;border:2px solid #374151;
background:#111827;color:#f3f4f6;font-size:16px;outline:none;transition:border-color .2s}
input:focus{border-color:#22c55e}
button{width:100%;padding:14px;border:none;border-radius:8px;background:#22c55e;
color:#fff;font-size:16px;font-weight:600;cursor:pointer;margin-top:16px;transition:background .2s}
button:hover{background:#16a34a}
button:active{background:#15803d}
</style>
</head>
<body>
<div class="card">
<h1>MoonTV</h1>
<p>输入关键词，电视将自动搜索</p>
$errorHtml
<form method="POST" action="/search">
<label for="keyword">搜索关键词</label>
<input type="text" name="keyword" id="keyword" placeholder="输入电影、电视剧名称..." required autofocus>
<button type="submit">发送到电视</button>
</form>
</div>
</body>
</html>
        """.trimIndent()
        sendResponse(writer, "200 OK", html)
    }

    private fun sendSuccessPage(writer: PrintWriter, keyword: String) {
        val html = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MoonTV - 已发送</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:#111827;color:#f3f4f6;
display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
.card{background:#1f2937;border-radius:16px;padding:32px;max-width:400px;width:100%;text-align:center}
.icon{font-size:48px;margin-bottom:16px}
h1{color:#22c55e;font-size:24px;margin-bottom:8px}
p{color:#9ca3af;font-size:14px;margin-bottom:8px}
.keyword{color:#22c55e;font-size:18px;margin:16px 0}
a{color:#22c55e;text-decoration:none;display:inline-block;margin-top:16px;font-size:14px}
</style>
</head>
<body>
<div class="card">
<div class="icon">&#10004;</div>
<h1>已发送到电视</h1>
<div class="keyword">"$keyword"</div>
<p>电视正在搜索中...</p>
<a href="/search">继续搜索</a>
</div>
</body>
</html>
        """.trimIndent()
        sendResponse(writer, "200 OK", html)
    }
}
