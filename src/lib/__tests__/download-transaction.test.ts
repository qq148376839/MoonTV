import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  acquireEpisodeLock,
  commitPlaylistAtomically,
  createEpisodeGeneration,
  redactDownloadUrl,
  redactUrlsInText,
  releaseEpisodeLock,
  validateLocalPlaylist,
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
});
