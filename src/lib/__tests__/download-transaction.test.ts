import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  acquireEpisodeLock,
  buildProgressivePlaylist,
  commitPlaylistAtomically,
  createEpisodeGeneration,
  parseMediaPlaylistResources,
  redactDownloadUrl,
  redactUrlsInText,
  releaseEpisodeLock,
  remapMediaPlaylistResources,
  validateLocalPlaylist,
  validateResumeFiles,
} from '../download-transaction';

describe('download transaction', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-download-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('redacts query and fragment from URLs exposed by APIs', () => {
    expect(
      redactDownloadUrl('https://cdn.example/video.m3u8?token=secret#part')
    ).toBe('https://cdn.example/video.m3u8');
    expect(
      redactUrlsInText(
        'failed https://cdn.example/a.ts?token=secret#part at segment'
      )
    ).toBe('failed https://cdn.example/a.ts at segment');
  });

  test('creates an isolated generation without touching the active playlist', () => {
    const active = path.join(root, 'episode_01.m3u8');
    fs.writeFileSync(active, '#EXTM3U\nold/segment_000.ts');

    const generation = createEpisodeGeneration(root, 1, 'generation-a');

    expect(fs.readFileSync(active, 'utf8')).toContain('old/segment_000.ts');
    expect(generation.relativePrefix).toBe(
      'episode_01_generations/generation-a'
    );
    expect(fs.existsSync(generation.segmentsDir)).toBe(true);
    expect(fs.existsSync(generation.keysDir)).toBe(true);
  });

  test('rejects a playlist when a referenced segment is missing or empty', () => {
    const generation = createEpisodeGeneration(root, 1, 'generation-b');
    fs.writeFileSync(
      generation.playlistPath,
      '#EXTM3U\n#EXTINF:1,\nsegments/segment_000.ts\n#EXTINF:1,\nsegments/segment_001.ts'
    );
    fs.writeFileSync(path.join(generation.segmentsDir, 'segment_000.ts'), 'ok');
    fs.writeFileSync(path.join(generation.segmentsDir, 'segment_001.ts'), '');

    expect(() => validateLocalPlaylist(generation.playlistPath)).toThrow(
      /缺失或为空/
    );
  });

  test('reports a playlist with no local media references as empty', () => {
    const playlist = path.join(root, 'empty.m3u8');
    fs.writeFileSync(playlist, '#EXTM3U\n#EXT-X-ENDLIST');
    expect(validateLocalPlaylist(playlist).references).toBe(0);
  });

  test('builds an event playlist from only the continuous playable prefix', () => {
    const source = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXTINF:5.5,',
      'segment-0.ts',
      '#EXTINF:6,',
      'segment-1.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:4,',
      'segment-2.ts',
      '#EXTINF:6,',
      'segment-3.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = buildProgressivePlaylist(
      source,
      'https://cdn.test/list.m3u8',
      {
        availableSegmentIndices: [0, 1, 3],
        availableKeyIndices: [0],
        availableMapIndices: [0],
        segmentUri: (index) => `/media/segment/${index}`,
        keyUri: (index) => `/media/key/${index}`,
        mapUri: (index) => `/media/map/${index}`,
      }
    );

    expect(result.segmentCount).toBe(2);
    expect(result.durationSeconds).toBe(11.5);
    expect(result.content).toContain('#EXT-X-PLAYLIST-TYPE:EVENT');
    expect(result.content).toContain('URI="/media/key/0"');
    expect(result.content).toContain('URI="/media/map/0"');
    expect(result.content).toContain('/media/segment/0');
    expect(result.content).toContain('/media/segment/1');
    expect(result.content).not.toContain('/media/segment/3');
    expect(result.content).not.toContain('#EXT-X-DISCONTINUITY');
    expect(result.content).not.toContain('#EXT-X-ENDLIST');
  });

  test('atomically replaces the entry playlist only after validation', () => {
    const active = path.join(root, 'episode_01.m3u8');
    fs.writeFileSync(active, '#EXTM3U\nold/segment_000.ts');
    const generation = createEpisodeGeneration(root, 1, 'generation-c');
    fs.writeFileSync(path.join(generation.segmentsDir, 'segment_000.ts'), 'ok');
    fs.writeFileSync(
      generation.playlistPath,
      '#EXTM3U\n#EXTINF:1,\nepisode_01_generations/generation-c/segments/segment_000.ts'
    );

    commitPlaylistAtomically(
      active,
      fs.readFileSync(generation.playlistPath, 'utf8')
    );

    expect(fs.readFileSync(active, 'utf8')).toContain('generation-c');
    expect(fs.existsSync(`${active}.tmp`)).toBe(false);
  });

  test('prevents concurrent writers for the same episode', () => {
    const lock = acquireEpisodeLock(root, 1, { taskId: 'first' });
    expect(() => acquireEpisodeLock(root, 1, { taskId: 'second' })).toThrow(
      /已有下载任务/
    );
    releaseEpisodeLock(lock);
    expect(() =>
      acquireEpisodeLock(root, 1, { taskId: 'third' })
    ).not.toThrow();
  });

  test('reclaims a lock left by a previous container instance with reused pid', () => {
    const lockPath = path.join(root, '.episode_01.download.lock');
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        taskId: 'previous-container',
        pid: process.pid,
        processInstance: 'previous-instance',
        startedAt: Date.now(),
      })
    );

    expect(() =>
      acquireEpisodeLock(root, 1, {
        taskId: 'current-container',
        pid: process.pid,
      })
    ).not.toThrow();
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8'))).toMatchObject({
      taskId: 'current-container',
      reclaimed: true,
    });
  });

  test('validates resumable files by existence, nonempty size, and expected length', () => {
    const valid = path.join(root, 'valid.ts');
    const empty = path.join(root, 'empty.ts');
    const wrong = path.join(root, 'wrong.ts');
    fs.writeFileSync(valid, 'valid');
    fs.writeFileSync(empty, '');
    fs.writeFileSync(wrong, 'short');

    expect(
      validateResumeFiles([
        { index: 0, path: valid, expectedLength: 5 },
        { index: 1, path: empty, expectedLength: null },
        { index: 2, path: wrong, expectedLength: 8 },
        { index: 3, path: path.join(root, 'missing.ts') },
      ])
    ).toEqual({ valid: [0], invalid: [1, 2, 3], bytes: 5 });
  });

  test('counts a duplicated resumable index only once', () => {
    const valid = path.join(root, 'valid.ts');
    fs.writeFileSync(valid, 'valid');

    expect(
      validateResumeFiles([
        { index: 0, path: valid, expectedLength: 5 },
        { index: 0, path: valid, expectedLength: 5 },
      ])
    ).toEqual({ valid: [0], invalid: [], bytes: 5 });
  });

  test('remaps by media sequence and excludes already completed segments', () => {
    const original = parseMediaPlaylistResources(
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:40\n#EXTINF:1,\nold-40.ts?token=old\n#EXTINF:1,\nold-41.ts?token=old',
      'https://old.example/list.m3u8?token=old'
    );
    const refreshed = parseMediaPlaylistResources(
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:40\n#EXTINF:1,\nnew-40.ts?token=new\n#EXTINF:1,\nnew-41.ts?token=new',
      'https://new.example/list.m3u8?token=new'
    );

    const remap = remapMediaPlaylistResources(original, refreshed, [0]);
    expect(remap.preservedSegmentIndices).toEqual([0]);
    expect(remap.pendingSegments).toEqual([
      expect.objectContaining({ index: 1, sequence: 41 }),
    ]);
    expect(remap.pendingSegments[0].url).toContain('new-41.ts?token=new');
  });

  test('preserves KEY and MAP relationships while replacing their signed URLs', () => {
    const original = parseMediaPlaylistResources(
      [
        '#EXTM3U',
        '#EXT-X-MEDIA-SEQUENCE:7',
        '#EXT-X-MAP:URI="init.mp4?token=old"',
        '#EXT-X-KEY:METHOD=AES-128,URI="first.key?token=old"',
        '#EXTINF:1,',
        '7.ts?token=old',
        '#EXT-X-KEY:METHOD=AES-128,URI="second.key?token=old"',
        '#EXTINF:1,',
        '8.ts?token=old',
      ].join('\n'),
      'https://old.example/list.m3u8'
    );
    const refreshed = parseMediaPlaylistResources(
      [
        '#EXTM3U',
        '#EXT-X-MEDIA-SEQUENCE:7',
        '#EXT-X-MAP:URI="fresh-init.mp4?token=new"',
        '#EXT-X-KEY:METHOD=AES-128,URI="fresh-first.key?token=new"',
        '#EXTINF:1,',
        'fresh-7.ts?token=new',
        '#EXT-X-KEY:METHOD=AES-128,URI="fresh-second.key?token=new"',
        '#EXTINF:1,',
        'fresh-8.ts?token=new',
      ].join('\n'),
      'https://new.example/list.m3u8'
    );

    const remap = remapMediaPlaylistResources(original, refreshed, []);
    expect(remap.keys.map((item) => item.url)).toEqual([
      'https://new.example/fresh-first.key?token=new',
      'https://new.example/fresh-second.key?token=new',
    ]);
    expect(remap.maps.map((item) => item.url)).toEqual([
      'https://new.example/fresh-init.mp4?token=new',
    ]);
    expect(
      remap.pendingSegments.map((item) => [item.keyIndex, item.mapIndex])
    ).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  test('rejects a refreshed playlist with incompatible media structure', () => {
    const original = parseMediaPlaylistResources(
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:4\n#EXTINF:1,\n4.ts\n#EXTINF:1,\n5.ts',
      'https://old.example/list.m3u8'
    );
    const refreshed = parseMediaPlaylistResources(
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:5\n#EXTINF:1,\n5.ts\n#EXTINF:1,\n6.ts',
      'https://new.example/list.m3u8'
    );

    expect(() => remapMediaPlaylistResources(original, refreshed, [])).toThrow(
      /structure mismatch/i
    );
  });
});
