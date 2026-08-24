import { NextRequest } from 'next/server';

const service = {
  getProgressivePlayback: jest.fn(),
};

jest.mock('@/lib/download-service', () => ({
  getDownloadService: () => service,
}));

import { GET } from '../[taskId]/play.m3u8/route';

const request = (episode = '1') =>
  ({
    nextUrl: new URL(
      `http://localhost/api/download/task-1/play.m3u8?episode=${episode}`
    ),
  } as unknown as NextRequest);

describe('progressive playback route', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns a growing HLS event playlist without caching', async () => {
    service.getProgressivePlayback.mockReturnValue({
      status: 'ready',
      content:
        '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:5,\n/api/local-video?path=one',
      segmentCount: 1,
      durationSeconds: 5,
      complete: false,
    });

    const response = await GET(request(), { params: { taskId: 'task-1' } });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(
      'application/vnd.apple.mpegurl'
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('#EXT-X-PLAYLIST-TYPE:EVENT');
  });

  test('reports that playback is not ready before the first continuous segment', async () => {
    service.getProgressivePlayback.mockReturnValue({ status: 'not_ready' });

    const response = await GET(request(), { params: { taskId: 'task-1' } });

    expect(response.status).toBe(409);
  });

  test('returns a rewritten complete playlist after download finishes', async () => {
    service.getProgressivePlayback.mockReturnValue({
      status: 'ready',
      content:
        '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:5,\n/api/local-video?path=one\n#EXT-X-ENDLIST',
      segmentCount: 1,
      durationSeconds: 5,
      complete: true,
    });

    const response = await GET(request(), { params: { taskId: 'task-1' } });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('#EXT-X-ENDLIST');
  });

  test('rejects partially numeric episode values', async () => {
    const response = await GET(request('1abc'), {
      params: { taskId: 'task-1' },
    });
    expect(response.status).toBe(400);
    expect(service.getProgressivePlayback).not.toHaveBeenCalled();
  });
});
