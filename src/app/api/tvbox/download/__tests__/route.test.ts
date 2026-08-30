import { NextRequest } from 'next/server';

const createTask = jest.fn(() => ({
  id: 'task-1',
  status: 'pending',
  progress: 0,
}));

jest.mock('@/lib/download-service', () => ({
  getDownloadService: () => ({ createTask }),
}));

jest.mock('@/lib/local-storage', () => ({
  getStorageManager: () => ({ isEnabled: () => true }),
}));

import { POST } from '../route';

test('passes per-episode playback headers to the download task', async () => {
  const body = {
    title: '施公奇案粤语',
    year: '0',
    episodes: [
      {
        name: '第1集',
        url: 'https://media.example/episode-1.m3u8',
        headers: {
          'User-Agent': 'TVBox Player',
          Referer: 'https://media.example/',
          Cookie: 'session=private',
        },
      },
    ],
  };
  const request = {
    json: async () => body,
  } as unknown as NextRequest;

  const response = await POST(request);

  expect(response.status).toBe(200);
  expect(createTask).toHaveBeenCalledWith(
    expect.any(Object),
    ['https://media.example/episode-1.m3u8'],
    [1],
    {
      episodeHeaders: [
        {
          'User-Agent': 'TVBox Player',
          Referer: 'https://media.example/',
          Cookie: 'session=private',
        },
      ],
    }
  );
});
