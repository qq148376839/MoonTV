import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import DownloadConfirmDialog from '../DownloadConfirmDialog';

describe('DownloadConfirmDialog', () => {
  test('sends force_redownload when safe replacement is selected', async () => {
    const previousFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: '下载任务已创建' }),
    } as Response);
    globalThis.fetch = fetchMock;

    render(
      <DownloadConfirmDialog
        open
        onClose={() => undefined}
        currentEpisodeIndex={0}
        detail={{
          id: 'movie-1',
          title: '测试影片',
          poster: '',
          episodes: ['https://media.example/movie.m3u8'],
          source: 'test-source',
          source_name: '测试源',
          year: '2026',
        }}
      />
    );

    fireEvent.click(screen.getByLabelText(/重新抓取源并安全替换/));
    fireEvent.click(screen.getByRole('button', { name: '开始下载' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      force_redownload: true,
      episode_numbers: [1],
    });
    globalThis.fetch = previousFetch;
  });
});
