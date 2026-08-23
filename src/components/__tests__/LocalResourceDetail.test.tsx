import { render, screen } from '@testing-library/react';

import LocalResourceDetail from '../LocalResourceDetail';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe('LocalResourceDetail', () => {
  afterEach(() => jest.restoreAllMocks());

  test('stacks episode controls and audit details in a responsive card grid', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        source: 'source-a',
        id: 'show-1',
        local_path: '/data/show-1',
        metadata: { title: '潜行狙击', year: '2011' },
        stats: { downloaded_episodes: 1, total_episodes: 1 },
        episode_status: [
          {
            episode: 1,
            downloaded: true,
            file_path: '/data/show-1/episode_01.m3u8',
            audit: {
              generation_id: 'g1',
              downloaded_at: 1,
              source_url:
                'https://example.com/a/very/long/source/address/list.m3u8',
              media_playlist_url: 'https://example.com/list.m3u8',
              address_method: 'direct',
              original_segments: 262,
              removed_segments: 0,
              final_segments: 262,
              removed_duration_sec: 0,
              filter_version: 'v2',
              validation_passed: true,
            },
            latest_failure: null,
          },
        ],
      }),
    } as Response);

    render(<LocalResourceDetail source='source-a' id='show-1' />);
    const card = await screen.findByTestId('episode-card-1');
    expect(card).toHaveClass('flex-col');
    expect(card.parentElement).toHaveClass('grid-cols-1', 'sm:grid-cols-2');
    expect(screen.getByTitle(/https:\/\/example.com/)).toHaveClass('truncate');
  });
});
