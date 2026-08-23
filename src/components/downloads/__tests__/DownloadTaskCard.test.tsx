import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import DownloadTaskCard, { DownloadTaskSummary } from '../DownloadTaskCard';

export function summaryFixture(
  overrides: Partial<DownloadTaskSummary> = {}
): DownloadTaskSummary {
  return {
    task_id: 'task-1',
    source: 'source',
    id: 'movie-1',
    title: '最佳损友',
    year: '1988',
    episode_numbers: [1],
    status: 'downloading',
    priority: 'normal',
    current_episode: 1,
    current_stage: 'downloading',
    progress: 63.1,
    progress_estimated: false,
    speed_bytes_per_second: 8.4 * 1024 * 1024,
    eta_seconds: 102,
    completed_bytes: 318 * 1024 * 1024,
    segments: {
      total: 504,
      completed: 318,
      active: 8,
      retries: 2,
      failed: 0,
    },
    recoverable: true,
    polling_fallback: false,
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

describe('DownloadTaskCard', () => {
  test('shows current episode stage speed eta bytes and segment counts', () => {
    render(<DownloadTaskCard task={summaryFixture()} onCommand={jest.fn()} />);

    expect(screen.getByText('第 1 集 · 下载分片')).toBeInTheDocument();
    expect(screen.getByText('318 / 504 分片')).toBeInTheDocument();
    expect(screen.getByText('8.4 MB/s')).toBeInTheDocument();
    expect(screen.getByText('剩余 01:42')).toBeInTheDocument();
    expect(screen.getByText('已写入 318 MB')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '63.1'
    );
  });

  test('uses unknown-safe speed and eta displays', () => {
    render(
      <DownloadTaskCard
        task={summaryFixture({
          speed_bytes_per_second: 0,
          eta_seconds: null,
          progress_estimated: true,
        })}
        onCommand={jest.fn()}
      />
    );

    expect(screen.getByText('速度 —')).toBeInTheDocument();
    expect(screen.getByText('剩余 —')).toBeInTheDocument();
    expect(screen.getByText('约 63.1%')).toBeInTheDocument();
  });

  test('loads details only when the card expands', async () => {
    const loadDetails = jest.fn().mockResolvedValue({
      ...summaryFixture(),
      episodes: [],
    });
    render(
      <DownloadTaskCard
        task={summaryFixture()}
        loadDetails={loadDetails}
        onCommand={jest.fn()}
      />
    );

    expect(loadDetails).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '展开详情' }));
    await waitFor(() => expect(loadDetails).toHaveBeenCalledWith('task-1'));
    expect(screen.getByRole('button', { name: '收起详情' })).toBeVisible();
  });

  test('refreshes expanded details when live task revision changes', async () => {
    const loadDetails = jest.fn().mockResolvedValue({
      ...summaryFixture(),
      episodes: [],
    });
    const onCommand = jest.fn();
    const { rerender } = render(
      <DownloadTaskCard
        task={summaryFixture()}
        loadDetails={loadDetails}
        onCommand={onCommand}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '展开详情' }));
    await waitFor(() => expect(loadDetails).toHaveBeenCalledTimes(1));

    rerender(
      <DownloadTaskCard
        task={summaryFixture({ updated_at: 3 })}
        loadDetails={loadDetails}
        onCommand={onCommand}
      />
    );
    await waitFor(() => expect(loadDetails).toHaveBeenCalledTimes(2));
  });

  test('marks existing details stale when a live refresh fails', async () => {
    const loadDetails = jest
      .fn()
      .mockResolvedValueOnce({ ...summaryFixture(), episodes: [] })
      .mockRejectedValueOnce(new Error('详情网络异常'));
    const { rerender } = render(
      <DownloadTaskCard
        task={summaryFixture()}
        loadDetails={loadDetails}
        onCommand={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '展开详情' }));
    await waitFor(() => expect(loadDetails).toHaveBeenCalledTimes(1));

    rerender(
      <DownloadTaskCard
        task={summaryFixture({ updated_at: 3 })}
        loadDetails={loadDetails}
        onCommand={jest.fn()}
      />
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '详情刷新失败，当前显示上次数据：详情网络异常'
    );
    expect(screen.getByText('分片诊断')).toBeInTheDocument();
  });

  test('requires explicit confirmation before cleaning temporary data', async () => {
    const onCommand = jest.fn().mockResolvedValue(undefined);
    render(
      <DownloadTaskCard
        task={summaryFixture({ status: 'cancelled_resumable' })}
        onCommand={onCommand}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '删除临时数据' }));
    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认删除临时数据' }));
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith('task-1', 'cancel_and_clean')
    );
  });

  test('only shows controls valid for the current state', () => {
    const onCommand = jest.fn();
    const { rerender } = render(
      <DownloadTaskCard
        task={summaryFixture({ status: 'downloading' })}
        onCommand={onCommand}
      />
    );
    expect(screen.getByRole('button', { name: '暂停' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: '恢复' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeVisible();
    expect(screen.getByRole('button', { name: '设为优先' })).toBeVisible();

    rerender(
      <DownloadTaskCard
        task={summaryFixture({ status: 'recovery_wait' })}
        onCommand={onCommand}
      />
    );
    expect(screen.getByRole('button', { name: '恢复' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: '暂停' })
    ).not.toBeInTheDocument();
  });

  test('offers direct recovery for a recoverable partially completed task', async () => {
    const onCommand = jest.fn().mockResolvedValue(undefined);
    render(
      <DownloadTaskCard
        task={summaryFixture({
          status: 'partial_completed',
          recoverable: true,
        })}
        onCommand={onCommand}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '恢复下载' }));
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith('task-1', 'resume')
    );
  });
});
