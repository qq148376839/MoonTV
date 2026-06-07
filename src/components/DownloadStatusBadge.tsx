import React from 'react';

type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | string;

const statusText: Record<string, string> = {
  pending: '排队中',
  downloading: '下载中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const statusClass: Record<string, string> = {
  pending: 'bg-gray-500/10 text-gray-700 dark:text-gray-200',
  downloading: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  paused: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
  completed: 'bg-green-500/10 text-green-700 dark:text-green-300',
  failed: 'bg-red-500/10 text-red-700 dark:text-red-300',
  cancelled: 'bg-gray-500/10 text-gray-700 dark:text-gray-200',
};

export default function DownloadStatusBadge({
  status,
}: {
  status: DownloadStatus;
}) {
  const text = statusText[status] ?? status;
  const cls =
    statusClass[status] ?? 'bg-gray-500/10 text-gray-700 dark:text-gray-200';

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded text-xs ${cls}`}
    >
      {text}
    </span>
  );
}
