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

  test('redirects completed playback to the committed local playlist', async () => {
    service.getProgressivePlayback.mockReturnValue({
      status: 'completed',
      playlistPath: '/data/video/episode_01.m3u8',
    });

    const response = await GET(request(), { params: { taskId: 'task-1' } });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'http://localhost/api/local-video?path=%2Fdata%2Fvideo%2Fepisode_01.m3u8'
    );
  });
});
