import { render, screen } from '@testing-library/react';

import type { DownloadTaskSummary } from '../downloads/DownloadTaskCard';
import { DownloadTaskListView } from '../DownloadTaskList';

function task(
  taskId: string,
  title: string,
  createdAt: number,
  updatedAt: number
): DownloadTaskSummary {
  return {
    task_id: taskId,
    title,
    status: 'downloading',
    priority: 'normal',
    current_episode: 1,
    current_stage: 'downloading',
    progress: 10,
    segments: { total: 10, completed: 1, active: 1, retries: 0, failed: 0 },
    recoverable: true,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

describe('DownloadTaskListView', () => {
  test('keeps task order stable when live progress updates updated_at', () => {
    const common = {
      connection: 'live' as const,
      loading: false,
      error: null,
      loadDetails: jest.fn(),
      onCommand: jest.fn(),
    };
    const first = task('first', '先创建任务', 1, 10);
    const second = task('second', '后创建任务', 2, 20);
    const { rerender } = render(
      <DownloadTaskListView tasks={[first, second]} {...common} />
    );

    expect(
      screen.getAllByRole('article').map((node) => node.textContent)
    ).toEqual([
      expect.stringContaining('先创建任务'),
      expect.stringContaining('后创建任务'),
    ]);

    rerender(
      <DownloadTaskListView
        tasks={[{ ...first, updated_at: 30 }, second]}
        {...common}
      />
    );
    expect(
      screen.getAllByRole('article').map((node) => node.textContent)
    ).toEqual([
      expect.stringContaining('先创建任务'),
      expect.stringContaining('后创建任务'),
    ]);
  });
});
