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
});
