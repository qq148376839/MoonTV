import { filterM3U8Ads } from '../ad-filter';

describe('filterM3U8Ads', () => {
  test('removes same-domain segments enclosed by HLS cue markers', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'https://media.example/movie-001.ts',
      '#EXT-X-CUE-OUT:DURATION=20',
      '#EXTINF:10,',
      'https://media.example/ad-001.ts',
      '#EXTINF:10,',
      'https://media.example/ad-002.ts',
      '#EXT-X-CUE-IN',
      '#EXTINF:10,',
      'https://media.example/movie-002.ts',
      ...Array.from({ length: 20 }, (_, index) => [
        '#EXTINF:10,',
        `https://media.example/movie-${String(index + 3).padStart(3, '0')}.ts`,
      ]).flat(),
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterM3U8Ads(playlist, {
      enableKeyword: false,
      enableDomain: false,
      enableDiscontinuity: true,
    });

    expect(result.applied).toBe(true);
    expect(result.removedSegments).toBe(2);
    expect(result.content).not.toContain('ad-001.ts');
    expect(result.content).not.toContain('ad-002.ts');
    expect(result.content).toContain('movie-001.ts');
    expect(result.content).toContain('movie-002.ts');
  });

  test('removes an isolated low-bitrate group from a periodic discontinuity playlist', () => {
    const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:5'];
    const byteLengths: number[] = [];
    for (let group = 0; group < 30; group += 1) {
      if (group > 0) lines.push('#EXT-X-DISCONTINUITY');
      for (let segment = 0; segment < 6; segment += 1) {
        const index = group * 6 + segment;
        lines.push('#EXTINF:4,', `segment-${index}.ts`);
        byteLengths.push(group === 12 ? 650_000 : 3_000_000);
      }
    }
    lines.push('#EXT-X-ENDLIST');

    const filterWithMetrics = filterM3U8Ads as unknown as (
      content: string,
      options: Record<string, unknown>
    ) => ReturnType<typeof filterM3U8Ads>;
    const result = filterWithMetrics(lines.join('\n'), {
      enableKeyword: false,
      enableDomain: false,
      enableDiscontinuity: true,
      segmentByteLengths: byteLengths,
    });

    expect(result.applied).toBe(true);
    expect(result.removedSegments).toBe(6);
    expect(result.removedDurationSec).toBe(24);
    expect(result.matchedReasons).toContain('isolated-bitrate-outlier');
    expect(result.content).not.toContain('segment-72.ts');
    expect(result.content).not.toContain('segment-77.ts');
    expect(result.content).toContain('segment-71.ts');
    expect(result.content).toContain('segment-78.ts');
  });
});
