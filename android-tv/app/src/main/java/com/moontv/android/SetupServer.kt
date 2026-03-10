package com.moontv.android

import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.ServerSocket
import java.net.URLDecoder
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Lightweight HTTP server that runs on the TV.
 * Phone scans QR → opens browser → enters server URL → TV receives it.
 */
class SetupServer(
    private val onUrlReceived: (String) -> Unit
) {
    private var serverSocket: ServerSocket? = null
    private val running = AtomicBoolean(false)
    var port: Int = 0
        private set

    fun start() {
        if (running.get()) return
        running.set(true)

        // Use a random available port
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
                            // Read headers
                            val headers = mutableMapOf<String, String>()
                            var line = reader.readLine()
                            while (line != null && line.isNotEmpty()) {
                                val parts = line.split(": ", limit = 2)
                                if (parts.size == 2) headers[parts[0].lowercase()] = parts[1]
                                line = reader.readLine()
                            }

                            when {
                                requestLine.startsWith("GET / ") || requestLine.startsWith("GET /setup ") -> {
                                    sendSetupPage(writer)
                                }
                                requestLine.startsWith("POST /setup ") -> {
                                    val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
                                    val body = CharArray(contentLength)
                                    reader.read(body, 0, contentLength)
                                    val bodyStr = String(body)
                                    val url = parseFormUrl(bodyStr)
                                    if (url.isNotBlank()) {
                                        onUrlReceived(url)
                                        sendSuccessPage(writer, url)
                                    } else {
                                        sendSetupPage(writer, "请输入有效的服务器地址")
                                    }
                                }
                                else -> {
                                    sendNotFound(writer)
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

    private fun parseFormUrl(body: String): String {
        val params = body.split("&")
        for (param in params) {
            val kv = param.split("=", limit = 2)
            if (kv.size == 2 && kv[0] == "url") {
                return URLDecoder.decode(kv[1], "UTF-8").trim().trimEnd('/')
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

    private fun sendSetupPage(writer: PrintWriter, error: String? = null) {
        val errorHtml = if (error != null) {
            "<div style='color:#ef4444;margin-bottom:16px;font-size:14px;'>$error</div>"
        } else ""

        val html = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MoonTV 设置</title>
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
.hint{color:#6b7280;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<div class="card">
<h1>MoonTV</h1>
<p>配置电视端服务器地址</p>
$errorHtml
<form method="POST" action="/setup">
<label for="url">服务器地址</label>
<input type="url" name="url" id="url" placeholder="http://192.168.1.100:1234" required autofocus>
<div class="hint">输入 MoonTV 服务器的完整地址，包含端口号</div>
<button type="submit">保存到电视</button>
</form>
</div>
</body>
</html>
        """.trimIndent()
        sendResponse(writer, "200 OK", html)
    }

    private fun sendSuccessPage(writer: PrintWriter, url: String) {
        val html = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MoonTV - 设置成功</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:#111827;color:#f3f4f6;
display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
.card{background:#1f2937;border-radius:16px;padding:32px;max-width:400px;width:100%;text-align:center}
.icon{font-size:48px;margin-bottom:16px}
h1{color:#22c55e;font-size:24px;margin-bottom:8px}
p{color:#9ca3af;font-size:14px;margin-bottom:8px}
.url{color:#22c55e;word-break:break-all;font-size:16px;margin:16px 0}
</style>
</head>
<body>
<div class="card">
<div class="icon">&#10004;</div>
<h1>设置成功</h1>
<p>服务器地址已保存到电视</p>
<div class="url">$url</div>
<p>电视端将自动加载，你可以关闭此页面</p>
</div>
</body>
</html>
        """.trimIndent()
        sendResponse(writer, "200 OK", html)
    }

    private fun sendNotFound(writer: PrintWriter) {
        sendResponse(writer, "404 Not Found", "<h1>Not Found</h1>")
    }
}
