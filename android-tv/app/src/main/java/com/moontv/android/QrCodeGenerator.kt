package com.moontv.android

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

object QrCodeGenerator {

    fun generate(text: String, moduleSize: Int = 12): Bitmap {
        val writer = QRCodeWriter()
        val hints = mapOf(
            EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.L,
            EncodeHintType.MARGIN to 2
        )
        val bitMatrix = writer.encode(text, BarcodeFormat.QR_CODE, 0, 0, hints)
        val width = bitMatrix.width
        val height = bitMatrix.height
        val bitmapWidth = width * moduleSize
        val bitmapHeight = height * moduleSize

        val bitmap = Bitmap.createBitmap(bitmapWidth, bitmapHeight, Bitmap.Config.ARGB_8888)
        for (y in 0 until height) {
            for (x in 0 until width) {
                val color = if (bitMatrix.get(x, y)) Color.BLACK else Color.WHITE
                for (dy in 0 until moduleSize) {
                    for (dx in 0 until moduleSize) {
                        bitmap.setPixel(x * moduleSize + dx, y * moduleSize + dy, color)
                    }
                }
            }
        }
        return bitmap
    }
}
