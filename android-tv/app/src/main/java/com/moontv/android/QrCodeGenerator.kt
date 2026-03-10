package com.moontv.android

import android.graphics.Bitmap
import android.graphics.Color

/**
 * Minimal QR code generator using only Android Bitmap.
 * Generates QR Code Version 2 (25x25) with ECC level L.
 * Supports alphanumeric + common URL characters via byte mode.
 */
object QrCodeGenerator {

    fun generate(text: String, moduleSize: Int = 12): Bitmap {
        val modules = encode(text)
        val size = modules.size
        val quiet = 4 // quiet zone modules
        val bitmapSize = (size + quiet * 2) * moduleSize
        val bitmap = Bitmap.createBitmap(bitmapSize, bitmapSize, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.WHITE)

        for (row in modules.indices) {
            for (col in modules[row].indices) {
                if (modules[row][col]) {
                    val x = (col + quiet) * moduleSize
                    val y = (row + quiet) * moduleSize
                    for (dy in 0 until moduleSize) {
                        for (dx in 0 until moduleSize) {
                            bitmap.setPixel(x + dx, y + dy, Color.BLACK)
                        }
                    }
                }
            }
        }
        return bitmap
    }

    // Simplified QR encoder - delegates to a basic implementation
    // For URLs up to ~40 chars, Version 2-L (25x25, byte mode, 32 data chars) works
    // For longer URLs, use Version 3-L (29x29, byte mode, 53 data chars)
    private fun encode(text: String): Array<BooleanArray> {
        val data = text.toByteArray(Charsets.UTF_8)
        // Choose version based on data length
        return if (data.size <= 32) {
            encodeVersion2(data)
        } else {
            encodeVersion3(data)
        }
    }

    private fun encodeVersion2(data: ByteArray): Array<BooleanArray> {
        val size = 25
        val modules = Array(size) { BooleanArray(size) }
        val isFunction = Array(size) { BooleanArray(size) }

        // Draw function patterns
        drawFinderPatterns(modules, isFunction, size)
        drawAlignmentPattern(modules, isFunction, 18, 18)
        drawTimingPatterns(modules, isFunction, size)
        drawFormatInfo(modules, isFunction, size, 0) // ECC L, mask 0

        // Encode data
        val codewords = encodeDataVersion2(data)
        placeData(modules, isFunction, size, codewords)

        // Apply mask 0 (checkerboard)
        applyMask(modules, isFunction, size, 0)

        return modules
    }

    private fun encodeVersion3(data: ByteArray): Array<BooleanArray> {
        val size = 29
        val modules = Array(size) { BooleanArray(size) }
        val isFunction = Array(size) { BooleanArray(size) }

        drawFinderPatterns(modules, isFunction, size)
        drawAlignmentPattern(modules, isFunction, 22, 22)
        drawTimingPatterns(modules, isFunction, size)
        drawFormatInfo(modules, isFunction, size, 0)

        val codewords = encodeDataVersion3(data)
        placeData(modules, isFunction, size, codewords)
        applyMask(modules, isFunction, size, 0)

        return modules
    }

    private fun drawFinderPatterns(modules: Array<BooleanArray>, isFunction: Array<BooleanArray>, size: Int) {
        // Three finder patterns at corners
        for (pos in listOf(Pair(0, 0), Pair(0, size - 7), Pair(size - 7, 0))) {
            drawFinderPattern(modules, isFunction, pos.first, pos.second, size)
        }
    }

    private fun drawFinderPattern(modules: Array<BooleanArray>, isFunction: Array<BooleanArray>, row: Int, col: Int, size: Int) {
        for (r in -1..7) {
            for (c in -1..7) {
                val rr = row + r
                val cc = col + c
                if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue
                val inOuter = r in 0..6 && c in 0..6
                val inMiddle = r in 1..5 && c in 1..5
                val inInner = r in 2..4 && c in 2..4
                modules[rr][cc] = inInner || (inOuter && !inMiddle)
                isFunction[rr][cc] = true
            }
        }
        // Separator
        for (i in -1..7) {
            markFunction(isFunction, row + i, col - 1, size)
            markFunction(isFunction, row + i, col + 7, size)
            markFunction(isFunction, row - 1, col + i, size)
            markFunction(isFunction, row + 7, col + i, size)
        }
    }

    private fun markFunction(isFunction: Array<BooleanArray>, r: Int, c: Int, size: Int) {
        if (r in 0 until size && c in 0 until size) {
            isFunction[r][c] = true
        }
    }

    private fun drawAlignmentPattern(modules: Array<BooleanArray>, isFunction: Array<BooleanArray>, row: Int, col: Int) {
        for (r in -2..2) {
            for (c in -2..2) {
                val v = maxOf(Math.abs(r), Math.abs(c))
                modules[row + r][col + c] = v != 1
                isFunction[row + r][col + c] = true
            }
        }
    }

    private fun drawTimingPatterns(modules: Array<BooleanArray>, isFunction: Array<BooleanArray>, size: Int) {
        for (i in 8 until size - 8) {
            modules[6][i] = i % 2 == 0
            isFunction[6][i] = true
            modules[i][6] = i % 2 == 0
            isFunction[i][6] = true
        }
        // Dark module
        modules[size - 8][8] = true
        isFunction[size - 8][8] = true
    }

    private fun drawFormatInfo(modules: Array<BooleanArray>, isFunction: Array<BooleanArray>, size: Int, mask: Int) {
        // ECC level L = 01, mask pattern
        val formatBits = FORMAT_BITS_L[mask]
        // Around top-left finder
        for (i in 0..5) {
            modules[8][i] = (formatBits shr i) and 1 == 1
            isFunction[8][i] = true
        }
        modules[8][7] = (formatBits shr 6) and 1 == 1
        isFunction[8][7] = true
        modules[8][8] = (formatBits shr 7) and 1 == 1
        isFunction[8][8] = true
        modules[7][8] = (formatBits shr 8) and 1 == 1
        isFunction[7][8] = true
        for (i in 9..14) {
            modules[14 - i][8] = (formatBits shr i) and 1 == 1
            isFunction[14 - i][8] = true
        }
        // Along bottom-left and top-right
        for (i in 0..7) {
            modules[size - 1 - i][8] = (formatBits shr i) and 1 == 1
            isFunction[size - 1 - i][8] = true
        }
        for (i in 8..14) {
            modules[8][size - 15 + i] = (formatBits shr i) and 1 == 1
            isFunction[8][size - 15 + i] = true
        }
    }

    // Format info bits for ECC level L, masks 0-7
    private val FORMAT_BITS_L = intArrayOf(
        0x77C4, 0x72F3, 0x7DAA, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976
    )

    private fun encodeDataVersion2(data: ByteArray): ByteArray {
        // Version 2-L: 44 total codewords, 34 data, 10 ECC
        val dataCw = 34
        val totalCw = 44
        return buildCodewords(data, dataCw, totalCw)
    }

    private fun encodeDataVersion3(data: ByteArray): ByteArray {
        // Version 3-L: 70 total codewords, 55 data, 15 ECC
        val dataCw = 55
        val totalCw = 70
        return buildCodewords(data, dataCw, totalCw)
    }

    private fun buildCodewords(data: ByteArray, dataCw: Int, totalCw: Int): ByteArray {
        // Byte mode indicator (0100) + character count
        val bits = mutableListOf<Boolean>()
        // Mode: byte (0100)
        addBits(bits, 0b0100, 4)
        // Character count (8 bits for version 1-9 byte mode)
        addBits(bits, data.size, 8)
        // Data bytes
        for (b in data) {
            addBits(bits, b.toInt() and 0xFF, 8)
        }
        // Terminator
        val maxBits = dataCw * 8
        val terminatorLen = minOf(4, maxBits - bits.size)
        for (i in 0 until terminatorLen) bits.add(false)
        // Pad to byte boundary
        while (bits.size % 8 != 0) bits.add(false)
        // Pad codewords
        val padBytes = intArrayOf(0xEC, 0x11)
        var padIdx = 0
        while (bits.size < maxBits) {
            addBits(bits, padBytes[padIdx % 2], 8)
            padIdx++
        }

        val dataBytes = ByteArray(dataCw)
        for (i in 0 until dataCw) {
            var v = 0
            for (j in 0..7) {
                v = (v shl 1) or if (bits[i * 8 + j]) 1 else 0
            }
            dataBytes[i] = v.toByte()
        }

        // Generate Reed-Solomon ECC
        val eccLen = totalCw - dataCw
        val ecc = reedSolomonEcc(dataBytes, eccLen)

        return dataBytes + ecc
    }

    private fun addBits(bits: MutableList<Boolean>, value: Int, count: Int) {
        for (i in count - 1 downTo 0) {
            bits.add((value shr i) and 1 == 1)
        }
    }

    // GF(256) Reed-Solomon with primitive polynomial 0x11D
    private fun reedSolomonEcc(data: ByteArray, eccLen: Int): ByteArray {
        val gen = rsGeneratorPoly(eccLen)
        val result = IntArray(eccLen)
        for (b in data) {
            val factor = (b.toInt() and 0xFF) xor result[0]
            System.arraycopy(result, 1, result, 0, eccLen - 1)
            result[eccLen - 1] = 0
            for (j in 0 until eccLen) {
                result[j] = result[j] xor gfMul(gen[j], factor)
            }
        }
        return ByteArray(eccLen) { result[it].toByte() }
    }

    private fun rsGeneratorPoly(degree: Int): IntArray {
        var poly = intArrayOf(1)
        for (i in 0 until degree) {
            val newPoly = IntArray(poly.size + 1)
            val root = gfPow(2, i)
            for (j in poly.indices) {
                newPoly[j] = newPoly[j] xor poly[j]
                newPoly[j + 1] = newPoly[j + 1] xor gfMul(poly[j], root)
            }
            poly = newPoly
        }
        // Return coefficients excluding leading 1
        return poly.sliceArray(1..poly.lastIndex)
    }

    private val GF_EXP = IntArray(256)
    private val GF_LOG = IntArray(256)

    init {
        var v = 1
        for (i in 0 until 255) {
            GF_EXP[i] = v
            GF_LOG[v] = i
            v = v shl 1
            if (v >= 256) v = v xor 0x11D
        }
        GF_EXP[255] = GF_EXP[0]
    }

    private fun gfMul(a: Int, b: Int): Int {
        if (a == 0 || b == 0) return 0
        return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255]
    }

    private fun gfPow(base: Int, exp: Int): Int {
        var result = 1
        for (i in 0 until exp) result = gfMul(result, base)
        return result
    }

    private fun placeData(modules: Array<BooleanArray>, isFunction: Array<BooleanArray>, size: Int, codewords: ByteArray) {
        var bitIdx = 0
        val totalBits = codewords.size * 8
        // Traverse right-to-left in column pairs, skipping column 6
        var right = size - 1
        while (right >= 1) {
            if (right == 6) right = 5 // Skip timing column
            val left = right - 1
            var upward = (((size - 1 - right) / 2) % 2 == 0)
            val rows = if (upward) (size - 1 downTo 0) else (0 until size)
            for (row in rows) {
                for (col in intArrayOf(right, left)) {
                    if (!isFunction[row][col] && bitIdx < totalBits) {
                        modules[row][col] = (codewords[bitIdx / 8].toInt() shr (7 - bitIdx % 8)) and 1 == 1
                        bitIdx++
                    }
                }
            }
            right -= 2
        }
    }

    private fun applyMask(modules: Array<BooleanArray>, isFunction: Array<BooleanArray>, size: Int, mask: Int) {
        for (r in 0 until size) {
            for (c in 0 until size) {
                if (!isFunction[r][c]) {
                    val invert = when (mask) {
                        0 -> (r + c) % 2 == 0
                        1 -> r % 2 == 0
                        2 -> c % 3 == 0
                        3 -> (r + c) % 3 == 0
                        else -> false
                    }
                    if (invert) modules[r][c] = !modules[r][c]
                }
            }
        }
    }
}
