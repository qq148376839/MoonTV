'use client';

import type {
  DownloadCommandAction,
  DownloadConnection,
} from '@/hooks/useDownloadTasks';
import { useDownloadTasks } from '@/hooks/useDownloadTasks';

import DownloadTaskCard, {
  DownloadTaskSummary,
} from './downloads/DownloadTaskCard';
import type { DownloadTaskDetail } from './downloads/DownloadTaskDetails';

type ViewProps = {
  tasks: DownloadTaskSummary[];
  connection: DownloadConnection;
  loading: boolean;
  error: string | null;
  loadDetails: (taskId: string) => Promise<DownloadTaskDetail>;
  onCommand: (
    taskId: string,
    action: DownloadCommandAction
  ) => Promise<void> | void;
};

export function DownloadTaskListView({
  tasks,
  connection,
  loading,
  error,
  loadDetails,
  onCommand,
}: ViewProps) {
  if (loading) {
    return (
      <div role='status' className='text-sm text-gray-600 dark:text-gray-300'>
        加载中…
      </div>
    );
  }
  return (
    <div className='space-y-3'>
      {connection === 'polling' && (
        <div
          role='status'
          className='rounded-lg border border-yellow-300/70 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-200'
        >
          实时连接已断开，正在轮询；下载任务状态不受影响。
        </div>
      )}
      {connection === 'connecting' && tasks.length > 0 && (
        <div role='status' className='text-xs text-gray-500'>
          正在连接实时进度…
        </div>
      )}
      {error && (
        <div
          role='alert'
          className='rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300'
        >
          网络异常：{error}（将自动重试）
        </div>
      )}
      {tasks.length === 0 ? (
        <div className='text-sm text-gray-600 dark:text-gray-300'>
          暂无下载任务
        </div>
      ) : (
        <div className='space-y-3'>
          {tasks
            .slice()
            .sort(
              (left, right) => (right.updated_at || 0) - (left.updated_at || 0)
            )
            .map((task) => (
              <DownloadTaskCard
                key={task.task_id}
                task={task}
                loadDetails={loadDetails}
                onCommand={onCommand}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export default function DownloadTaskList() {
  const downloads = useDownloadTasks();
  return (
    <DownloadTaskListView
      tasks={downloads.tasks}
      connection={downloads.connection}
      loading={downloads.loading}
      error={downloads.error}
      loadDetails={downloads.loadDetails}
      onCommand={downloads.command}
    />
  );
}
