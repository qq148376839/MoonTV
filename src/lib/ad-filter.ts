/**
 * 统一 M3U8 去广告模块（下载层 + serve 层共用）
 *
 * 多策略组合（按顺序应用，命中即标记删除）：
 *   1. 关键词黑名单：URL 命中广告域名/路径正则
 *   2. 少数派域名：绝对 URL 中非主域名的片段
 *   3. DISCONTINUITY 分组 + 时长占比：被成对 DISCONTINUITY 包裹的短小段落
 *
 * 内置「保护性回退」：一旦拟删除总时长超过阈值，判定算法可能误伤正片，
 * 放弃全部过滤并返回原内容（applied=false），宁可漏删一条广告，不可错剪正片。
 *
 * 注意：本地落盘的 m3u8 是相对路径（无域名），域名/关键词策略对其自动失效，
 * 此时只有 DISCONTINUITY 策略生效——这正是 serve 层兜底的工作模式。
 */

export interface AdFilterOptions {
  /** 少数派域名判定（仅对含绝对 URL 的源 m3u8 有效），默认 false */
  enableDomain?: boolean;
  /** 关键词/正则黑名单，默认 false */
  enableKeyword?: boolean;
  /** DISCONTINUITY 分组 + 时长占比（核心策略，两层都有效），默认 true */
  enableDiscontinuity?: boolean;
  /** 保护阈值：过滤后至少保留总时长比例，默认 0.6（删除超 40% 则放弃） */
  minKeepRatio?: number;
  /** 单个广告组时长上限（秒），默认 90 */
  adMaxGroupSec?: number;
  /** 单个广告组时长占比上限，默认 0.10 */
  adMaxGroupRatio?: number;
  /** 已下载分片的实际字节数，按播放列表顺序排列 */
  segmentByteLengths?: readonly number[];
}

export interface AdFilterResult {
  /** 过滤后的 m3u8（触发回退时为原内容） */
  content: string;
  /** 是否真正执行了过滤 */
  applied: boolean;
  /** 删除的片段数 */
  removedSegments: number;
  /** 删除的总时长（秒） */
  removedDurationSec: number;
  /** 未过滤/回退原因，便于日志观测 */
  reason?: string;
  /** 实际命中的过滤规则，供下载审计使用 */
  matchedReasons?: string[];
  /** 被删除分片在输入播放列表中的位置 */
  removedSegmentIndices?: number[];
}

// 广告 URL 特征正则（从 M3U8Cleaner.CLEAN_PATTERNS 扩充而来）
const AD_URL_PATTERNS: RegExp[] = [
  /cachem3u8\.2s0\.cn/i,
  /(^|[/.])ads?[/.\-_]/i, // /ad/ /ads/ .ad. -ad_ 等
  /\/advertisement\//i,
];

interface Seg {
  index: number;
  extinfIdx: number; // #EXTINF 行号，-1 表示无
  urlIdx: number; // segment URL 行号
  duration: number;
  url: string;
  group: number;
  ad: boolean;
  reasons: Set<string>;
}

const DISCONTINUITY_RE = /^#EXT-X-DISCONTINUITY\s*$/;

// HLS 广告插入常用 cue 标记；这类广告片段经常与正片使用同一域名。
const CUE_OUT_RE = /^#EXT-X-CUE-OUT(?::|$)/i;
const CUE_IN_RE = /^#EXT-X-CUE-IN\s*$/i;
const AD_DATERANGE_RE =
  /^#EXT-X-DATERANGE:.*(?:CLASS="[^"]*(?:ad|interstitial|scte)[^"]*"|SCTE35-OUT=)/i;

export function filterM3U8Ads(
  content: string,
  opts: AdFilterOptions = {}
): AdFilterResult {
  const {
    enableDomain = false,
    enableKeyword = false,
    enableDiscontinuity = true,
    minKeepRatio = 0.6,
    adMaxGroupSec = 90,
    adMaxGroupRatio = 0.1,
    segmentByteLengths,
  } = opts;

  const lines = content.split('\n');
  const segs: Seg[] = [];
  const discIdx: number[] = []; // 纯 DISCONTINUITY 行号
  let curGroup = 0;
  let pendingDur = 0;
  let pendingExtinf = -1;

  // ── Pass 1: 解析为 segment + DISCONTINUITY 分组 ──
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    if (t.startsWith('#EXT-X-DISCONTINUITY')) {
      // 只匹配纯 DISCONTINUITY，排除 #EXT-X-DISCONTINUITY-SEQUENCE
      if (DISCONTINUITY_RE.test(t)) {
        discIdx.push(i);
        curGroup++;
      }
      continue;
    }
    if (CUE_OUT_RE.test(t) || AD_DATERANGE_RE.test(t)) {
      // 将 cue 后的片段放入独立分组，复用现有的短广告组判定。
      curGroup++;
      continue;
    }
    if (CUE_IN_RE.test(t)) {
      // cue-in 后的正片进入新分组，避免与广告组混合统计。
      curGroup++;
      continue;
    }
    if (t.startsWith('#EXTINF')) {
      const m = t.match(/#EXTINF:\s*([\d.]+)/);
      pendingDur = m ? parseFloat(m[1]) : 0;
      pendingExtinf = i;
      continue;
    }
    if (t.length > 0 && !t.startsWith('#')) {
      // segment URL 行
      segs.push({
        index: segs.length,
        extinfIdx: pendingExtinf,
        urlIdx: i,
        duration: pendingDur,
        url: t,
        group: curGroup,
        ad: false,
        reasons: new Set<string>(),
      });
      pendingDur = 0;
      pendingExtinf = -1;
    }
  }

  if (segs.length === 0) {
    return {
      content,
      applied: false,
      removedSegments: 0,
      removedDurationSec: 0,
      reason: '无 segment',
    };
  }

  const totalDur = segs.reduce((s, x) => s + x.duration, 0);

  // ── 策略 1: 关键词黑名单 ──
  if (enableKeyword) {
    for (const s of segs) {
      if (AD_URL_PATTERNS.some((re) => re.test(s.url))) {
        s.ad = true;
        s.reasons.add('keyword');
      }
    }
  }

  // ── 策略 2: 少数派域名（仅绝对 URL）──
  if (enableDomain) {
    const domainDur = new Map<string, number>();
    for (const s of segs) {
      if (/^https?:\/\//i.test(s.url)) {
        try {
          const d = new URL(s.url).hostname;
          domainDur.set(d, (domainDur.get(d) || 0) + s.duration);
        } catch {
          // ignore invalid URL
        }
      }
    }
    if (domainDur.size > 1) {
      // 时长最大的域名 = 正片域名
      let mainDomain = '';
      let maxDur = 0;
      for (const [d, dur] of Array.from(domainDur.entries())) {
        if (dur > maxDur) {
          maxDur = dur;
          mainDomain = d;
        }
      }
      for (const s of segs) {
        if (/^https?:\/\//i.test(s.url)) {
          try {
            const d = new URL(s.url).hostname;
            if (d !== mainDomain) {
              s.ad = true;
              s.reasons.add('minority-domain');
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }

  // ── 策略 3: DISCONTINUITY 分组 + 时长占比 ──
  if (enableDiscontinuity && curGroup > 0) {
    const groupDur = new Map<number, number>();
    const groupSegments = new Map<number, Seg[]>();
    for (const s of segs) {
      groupDur.set(s.group, (groupDur.get(s.group) || 0) + s.duration);
      const members = groupSegments.get(s.group) ?? [];
      members.push(s);
      groupSegments.set(s.group, members);
    }
    const completeGroups = Array.from(groupSegments.entries()).filter(
      ([g]) => g < curGroup
    );
    const countFrequency = new Map<number, number>();
    for (const [, members] of completeGroups) {
      countFrequency.set(
        members.length,
        (countFrequency.get(members.length) ?? 0) + 1
      );
    }
    const dominantGroupCount = Array.from(countFrequency.entries()).sort(
      (left, right) => right[1] - left[1]
    )[0];
    const periodicDiscontinuities =
      completeGroups.length >= 10 &&
      dominantGroupCount !== undefined &&
      dominantGroupCount[1] / completeGroups.length >= 0.8;

    if (periodicDiscontinuities && segmentByteLengths?.length === segs.length) {
      const groups = Array.from(groupSegments.entries()).sort(
        ([left], [right]) => left - right
      );
      const bitrate = (members: Seg[]): number => {
        const duration = members.reduce(
          (sum, segment) => sum + segment.duration,
          0
        );
        const bytes = members.reduce(
          (sum, segment) => sum + (segmentByteLengths[segment.index] ?? 0),
          0
        );
        return duration > 0 ? (bytes * 8) / duration : 0;
      };
      for (let index = 1; index < groups.length - 1; index += 1) {
        const [, previous] = groups[index - 1];
        const [, current] = groups[index];
        const [, next] = groups[index + 1];
        const duration = current.reduce(
          (sum, segment) => sum + segment.duration,
          0
        );
        const ratio = totalDur > 0 ? duration / totalDur : 0;
        const neighboringBitrate = Math.min(bitrate(previous), bitrate(next));
        if (
          current.length === previous.length &&
          current.length === next.length &&
          duration < adMaxGroupSec &&
          ratio < adMaxGroupRatio &&
          neighboringBitrate > 0 &&
          bitrate(current) < neighboringBitrate * 0.35
        ) {
          for (const segment of current) {
            segment.ad = true;
            segment.reasons.add('isolated-bitrate-outlier');
          }
        }
      }
    } else if (!periodicDiscontinuities) {
      for (const [g, dur] of Array.from(groupDur.entries())) {
        // 片头第 0 组豁免：开头无前导 DISCONTINUITY 时，group 0 是片头正片，
        // 不可因其短小而误删（VOD 起始保护，见 PRD 算法第 4 步）
        if (g === 0) continue;
        const ratio = totalDur > 0 ? dur / totalDur : 0;
        if (dur < adMaxGroupSec && ratio < adMaxGroupRatio) {
          // 整组标记为广告
          for (const s of segs) {
            if (s.group === g) {
              s.ad = true;
              s.reasons.add('short-discontinuity-group');
            }
          }
        }
      }
    }
  }

  const adSegs = segs.filter((s) => s.ad);
  const removedDur = adSegs.reduce((s, x) => s + x.duration, 0);
  const removedCount = adSegs.length;

  if (removedCount === 0) {
    return {
      content,
      applied: false,
      removedSegments: 0,
      removedDurationSec: 0,
      reason: '未发现广告',
    };
  }

  // ── 保护性回退 ──
  if (totalDur > 0 && removedDur > (1 - minKeepRatio) * totalDur) {
    return {
      content,
      applied: false,
      removedSegments: 0,
      removedDurationSec: 0,
      reason: `保护性回退: 拟删 ${removedDur.toFixed(1)}s 超过总时长 ${(
        (1 - minKeepRatio) *
        100
      ).toFixed(0)}% 阈值`,
    };
  }

  // ── 标记要删除的行：广告 segment 的 URL 行 + 其 #EXTINF 行 ──
  const delLines = new Set<number>();
  for (const s of adSegs) {
    delLines.add(s.urlIdx);
    if (s.extinfIdx >= 0) delLines.add(s.extinfIdx);
  }

  // ── DISCONTINUITY 规整：紧邻广告组的边界 DISC 删除，正片无缝拼接 ──
  // 判定「广告组」：组内全部片段都是广告
  const groupStat = new Map<number, { dur: number; adDur: number }>();
  for (const s of segs) {
    const g = groupStat.get(s.group) || { dur: 0, adDur: 0 };
    g.dur += s.duration;
    if (s.ad) g.adDur += s.duration;
    groupStat.set(s.group, g);
  }
  const groupIsAd = new Map<number, boolean>();
  for (const [g, v] of Array.from(groupStat.entries())) {
    groupIsAd.set(g, v.adDur > 0 && v.adDur >= v.dur * 0.999);
  }

  for (const di of discIdx) {
    // 该 DISC 之前最近 segment 的组、之后最近 segment 的组
    let prevG: number | null = null;
    let nextG: number | null = null;
    for (let k = segs.length - 1; k >= 0; k--) {
      if (segs[k].urlIdx < di) {
        prevG = segs[k].group;
        break;
      }
    }
    for (let k = 0; k < segs.length; k++) {
      if (segs[k].urlIdx > di) {
        nextG = segs[k].group;
        break;
      }
    }
    const prevAd = prevG != null && groupIsAd.get(prevG) === true;
    const nextAd = nextG != null && groupIsAd.get(nextG) === true;
    if (prevAd || nextAd) delLines.add(di);
  }

  // ── 重建 ──
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (delLines.has(i)) continue;
    out.push(lines[i]);
  }

  // 清理残留的连续重复 DISCONTINUITY（保险）
  const cleaned: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const t = out[i].trim();
    if (DISCONTINUITY_RE.test(t)) {
      let prev = cleaned.length - 1;
      while (prev >= 0 && cleaned[prev].trim() === '') prev--;
      if (prev >= 0 && DISCONTINUITY_RE.test(cleaned[prev].trim())) continue;
    }
    cleaned.push(out[i]);
  }

  return {
    content: cleaned.join('\n'),
    applied: true,
    removedSegments: removedCount,
    removedDurationSec: removedDur,
    matchedReasons: Array.from(
      new Set(adSegs.flatMap((segment) => Array.from(segment.reasons)))
    ),
    removedSegmentIndices: adSegs.map((segment) => segment.index),
  };
}
