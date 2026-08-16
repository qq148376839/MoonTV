import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import type { DownloadTaskSummary } from '../DownloadTaskCard';
import DownloadTaskDetails, {
  DownloadTaskDetail,
} from '../DownloadTaskDetails';
import DownloadTaskList, { DownloadTaskListView } from '../../DownloadTaskList';

function summaryFixture(): DownloadTaskSummary {
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
  };
}

function detailFixture(): DownloadTaskDetail {
  return {
    ...summaryFixture(),
    episodes: [
      {
        episode: 1,
        stage: 'partial_failed',
        generation_id: 'generation-private',
        segment_ranges: {
          completed: [[0, 317]],
          failed: [[319, 320]],
        },
        segments: { total: 504, completed: 318, active: 2, failed: 2 },
        key: { total: 1, completed: 1 },
        map: { total: 1, completed: 1 },
        active_items: [
          {
            episode: 1,
            generationId: 'generation-private',
            kind: 'segment',
            index: 318,
            attempt: 2,
          },
        ],
        failures: [
          {
            kind: 'segment',
            index: 319,
            category: 'timeout',
            attempts: 3,
            path: 'segment-319.ts',
            message: '请求超时',
          },
        ],
        completed_bytes: 318 * 1024 * 1024,
        estimated_bytes: 504 * 1024 * 1024,
        progress: 63.1,
        progress_estimated: false,
        speed_bytes_per_second: 8.4 * 1024 * 1024,
        eta_seconds: 102,
        old_entry_retained: true,
        recoverable: true,
        refresh_count: 1,
        ad_filter: {
          original_segments: 510,
          removed_segments: 6,
          final_segments: 504,
          removed_duration_seconds: 31.5,
          filter_version: 'v2',
          validation_passed: true,
        },
        updated_at: 2,
      },
    ],
  };
}

describe('DownloadTaskDetails', () => {
  test('shows episode stages segment diagnostics concurrency ad summary and safety', () => {
    render(
      <DownloadTaskDetails detail={detailFixture()} onCommand={jest.fn()} />
    );

    expect(
      screen.getByRole('heading', { name: '第 1 集' })
    ).toBeInTheDocument();
    expect(screen.getByText('KEY 1 / 1')).toBeInTheDocument();
    expect(screen.getByText('MAP 1 / 1')).toBeInTheDocument();
    expect(screen.getByText('任务槽位 1 / 全局 —')).toBeInTheDocument();
    expect(screen.getByText(/过滤 6 个分片/)).toBeInTheDocument();
    expect(screen.getByText(/旧播放入口已保留/)).toBeInTheDocument();
    expect(screen.getByText('segment-319.ts')).toBeInTheDocument();
    expect(screen.getByText(/timeout · 3 次/)).toBeInTheDocument();
    expect(screen.queryByText(/generation-private/)).not.toBeInTheDocument();
  });

  test('retries only failed items', async () => {
    const onCommand = jest.fn().mockResolvedValue(undefined);
    render(
      <DownloadTaskDetails detail={detailFixture()} onCommand={onCommand} />
    );
    fireEvent.click(screen.getByRole('button', { name: '仅重试失败项' }));
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith('task-1', 'retry_failed')
    );
  });

  test('never renders signed query or fragment from failure fields', () => {
    const detail = detailFixture();
    detail.episodes[0].failures[0].path =
      'https://cdn.example/segment.ts?token=secret#private';
    detail.episodes[0].failures[0].message =
      'failed https://cdn.example/segment.ts?auth=secret#trace';
    render(<DownloadTaskDetails detail={detail} onCommand={jest.fn()} />);

    expect(
      screen.queryByText(/token=secret|auth=secret|#private|#trace/)
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText(/https:\/\/cdn\.example\/segment\.ts/)
    ).not.toHaveLength(0);
  });

  test('shows polling fallback without marking the task failed', () => {
    render(
      <DownloadTaskListView
        connection='polling'
        tasks={[summaryFixture()]}
        loading={false}
        error={null}
        loadDetails={jest.fn()}
        onCommand={jest.fn()}
      />
    );
    expect(screen.getByText(/实时连接已断开，正在轮询/)).toBeInTheDocument();
    expect(screen.queryByText('下载失败')).not.toBeInTheDocument();
  });

  test('renders accessible loading error and empty states', () => {
    const props = {
      connection: 'connecting' as const,
      tasks: [],
      loadDetails: jest.fn(),
      onCommand: jest.fn(),
    };
    const { rerender } = render(
      <DownloadTaskListView {...props} loading error={null} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('加载中');

    rerender(
      <DownloadTaskListView {...props} loading={false} error='网络异常' />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('网络异常');

    rerender(<DownloadTaskListView {...props} loading={false} error={null} />);
    expect(screen.getByText('暂无下载任务')).toBeInTheDocument();
  });

  test('falls back to REST polling when the SSE connection fails', async () => {
    const originalFetch = globalThis.fetch;
    const originalEventSource = globalThis.EventSource;
    let sourceCreated = false;
    let failSource: () => void = () => undefined;
    class FakeEventSource {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public readonly url: string) {
        sourceCreated = true;
        failSource = () => this.onerror?.();
      }
      addEventListener() {
        return undefined;
      }
      close() {
        return undefined;
      }
    }
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tasks: [summaryFixture()] }),
    } as Response);
    globalThis.EventSource =
      FakeEventSource as unknown as typeof globalThis.EventSource;

    const { unmount } = render(<DownloadTaskList />);
    await waitFor(() => expect(sourceCreated).toBe(true));
    await act(async () => failSource());
    expect(
      await screen.findByText(/实时连接已断开，正在轮询/)
    ).toBeInTheDocument();
    expect(screen.getByText('下载中')).toBeInTheDocument();

    unmount();
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
  });
});
