package com.moontv.android.ui

/**
 * Pinyin matching utility for Chinese character input on TV.
 * Uses a built-in lookup table to convert Chinese characters to pinyin initials.
 * No external library dependency.
 */
object PinyinHelper {

    /**
     * Get pinyin initials for a Chinese string.
     * e.g. "雷神" → "ls", "复仇者联盟" → "fczlm"
     */
    fun getInitials(text: String): String {
        val sb = StringBuilder()
        for (c in text) {
            if (c.code in 0x4E00..0x9FFF) {
                val initial = getPinyinInitial(c)
                if (initial != null) {
                    sb.append(initial)
                }
            } else if (c.isLetterOrDigit()) {
                sb.append(c.lowercaseChar())
            }
        }
        return sb.toString()
    }

    /**
     * Check if input matches the title (case-insensitive).
     * Matches against: pinyin initials, original title contains, starts-with.
     */
    fun matches(input: String, title: String): Boolean {
        val lower = input.lowercase()
        val titleLower = title.lowercase()

        // Direct substring match
        if (titleLower.contains(lower)) return true

        // Pinyin initial match
        val initials = getInitials(title)
        if (initials.contains(lower)) return true

        return false
    }

    /**
     * Filter a list of titles by pinyin/text match, returning matched titles.
     */
    fun filter(input: String, titles: List<String>): List<String> {
        if (input.isBlank()) return emptyList()
        return titles.filter { matches(input, it) }
    }

    /**
     * Get the pinyin initial letter for a Chinese character.
     * Based on GB2312 ordering of Chinese characters by pinyin.
     */
    private fun getPinyinInitial(c: Char): Char? {
        // Boundary code points for each pinyin initial in Unicode CJK block
        // These are approximate boundaries based on common character frequency
        val code = c.code
        if (code < 0x4E00 || code > 0x9FFF) return null

        // Use a simplified lookup based on the Unicode-to-pinyin mapping
        // The table maps Unicode ranges to their most common pinyin initial
        for ((initial, ranges) in PINYIN_TABLE) {
            for (range in ranges) {
                if (code in range) return initial
            }
        }

        return null
    }

    // Pinyin initial lookup table based on common CJK characters
    // Each entry maps a pinyin initial to Unicode code point ranges
    private val PINYIN_TABLE: Map<Char, List<IntRange>> by lazy {
        buildPinyinTable()
    }

    private fun buildPinyinTable(): Map<Char, List<IntRange>> {
        // Map individual common characters to their pinyin initials
        val charMap = HashMap<Int, Char>()
        val sampleData = PINYIN_CHAR_DATA
        for (line in sampleData) {
            val initial = line[0]
            for (i in 1 until line.length) {
                charMap[line[i].code] = initial
            }
        }

        // Build range-based table from individual mappings is complex;
        // instead, store the char map and use direct lookup
        // Store as single-element ranges for the map interface
        val result = HashMap<Char, MutableList<IntRange>>()
        for ((code, initial) in charMap) {
            result.getOrPut(initial) { mutableListOf() }.add(code..code)
        }
        return result
    }

    // Common Chinese characters grouped by pinyin initial
    // ~100 most frequent characters per initial covers most video titles
    private val PINYIN_CHAR_DATA = arrayOf(
        "A爱安暗按案昂奥傲熬澳岸矮艾碍哀唉嗷凹",
        "B不把被本比变别部白北半边八步百表办报备帮保必包便病拨笔波板般播巴班倍败版邦辩避抱补壁臂膀扮辈",
        "C从此才长成出处村产程常城场层次曾差传采春船藏策查拆存除穿充冲触纯促撤沉串仓创残唱陈粗搓蔡参测",
        "D到大的地得都对当第多但点定动东道带打电底代度短单独段读党断调低端达答弹待德岛顿队蹲堆盗洞杜丹叠",
        "E而二恩儿尔耳额鹅鄂饿",
        "F发放风分非法反复服飞否份夫福房副逢凡防犯翻罚范封付费赴沸奋丰佛扶符府富缝肺腐",
        "G给过国个高工公共跟感关果该更根各格光古观功故干刚告够管规怪拐官鬼贵广龟归顾固岗港钢",
        "H好还会和后很回话花红活海合黑化火何画坏换喝河候护号黄灰怀害户华毁惠恨厚辉虎荒皇胡欢忽",
        "J就将近进家见己及机几记既究结今军决间集极紧急加计件局解即节金景具精交接酒举经据旧继绝尽",
        "K看可开口快空苦课哭肯块科恐控客靠扛抗康宽款困况枯跨夸酷",
        "L来了力里老两路拉利六落理论立连领令留灵另流量楼龙联冷离类例礼拦乱临零陆录绿略轮律旅律率",
        "M没面明每目名马满命门美民每妈买卖慢忙猫梦迷密免眠模某母木牧墓幕亩",
        "N那你年内能女南难脑拿呢哪怒弄念娘牛宁农奶纳尼凝扭虐暖诺奴",
        "O哦欧偶呕殴鸥藕",
        "P片平怕跑朋旁配排派普破盘飘品拍偏漂凭骗炮拼批评铺仆扑",
        "Q去前全起其请清且气亲确切强求青取权轻却奇期七枪球千巧群缺泉签墙穷琴禽侵秋圈趣曲屈",
        "R人日如入让然认任热仍容忍柔肉软若弱绕扰染瑞",
        "S是说时三上手所生死水似事十四算山身受使世实声收双少数思斯虽诉谁松司社识属术素速设省首深",
        "T他她它天太头同听通突条特提题体跳退推停痛团土图套逃铁踢替台抬态贴透拖填",
        "W我为无问外完万往物五位文望忘围闻味温屋武卫微未维握网王危晚弯威湾",
        "X想下小心些行新相学先像信星笑选续现线西系消息许写血需响乡形修醒幸性兄宣旋",
        "Y一有也要以用又已于与因原由远月越意眼样应影云员音言游叶油阳医衣验引印迎映院圆约运",
        "Z在这中子自最做走怎只知着正直总真主住字站整准找周张转足组座则增造众值指证展至装左责职治"
    )
}
