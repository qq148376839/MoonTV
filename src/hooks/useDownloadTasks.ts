'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { DownloadTaskSummary } from '@/components/downloads/DownloadTaskCard';
import type { DownloadTaskDetail } from '@/components/downloads/DownloadTaskDetails';

export type DownloadConnection = 'connecting' | 'live' | 'polling';
export type DownloadCommandAction =
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'cancel_and_clean'
  | 'retry_failed'
  | 'prioritize';

async function responseJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : `请求失败：${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export function useDownloadTasks() {
  const [tasks, setTasks] = useState<DownloadTaskSummary[]>([]);
  const [connection, setConnection] =
    useState<DownloadConnection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const connectionRef = useRef<DownloadConnection>('connecting');
  const sourceRef = useRef<EventSource | null>(null);
  const pollingRef = useRef<number | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const refreshQueuedRef = useRef(false);
  const refreshGenerationRef = useRef(0);
  const modeGenerationRef = useRef(0);

  const refresh = useCallback((): Promise<void> => {
    refreshGenerationRef.current += 1;
    if (refreshPromiseRef.current) {
      refreshQueuedRef.current = true;
      return refreshPromiseRef.current;
    }

    const run = async (): Promise<void> => {
      const generation = refreshGenerationRef.current;
      try {
        const data = await responseJson<{ tasks?: DownloadTaskSummary[] }>(
          await fetch('/api/download', { cache: 'no-store' })
        );
        if (generation === refreshGenerationRef.current) {
          setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
          setError(null);
        }
      } catch (reason) {
        if (generation === refreshGenerationRef.current) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        setLoading(false);
        refreshPromiseRef.current = null;
        if (refreshQueuedRef.current) {
          refreshQueuedRef.current = false;
          refreshPromiseRef.current = run();
        }
      }
    };

    refreshPromiseRef.current = run();
    return refreshPromiseRef.current;
  }, []);

  useEffect(() => {
    let disposed = false;
    const changeConnection = (next: DownloadConnection) => {
      modeGenerationRef.current += 1;
      connectionRef.current = next;
      setConnection(next);
    };

    const clearPolling = () => {
      if (pollingRef.current !== null) window.clearTimeout(pollingRef.current);
      pollingRef.current = null;
    };
    const poll = async (generation: number) => {
      if (
        disposed ||
        connectionRef.current !== 'polling' ||
        generation !== modeGenerationRef.current
      )
        return;
      await refresh();
      if (
        disposed ||
        connectionRef.current !== 'polling' ||
        generation !== modeGenerationRef.current
      )
        return;
      pollingRef.current = window.setTimeout(
        () => void poll(generation),
        document.hidden ? 8000 : 2000
      );
    };
    const connect = () => {
      if (disposed || typeof EventSource === 'undefined') {
        changeConnection('polling');
        void poll(modeGenerationRef.current);
        return;
      }
      clearPolling();
      changeConnection('connecting');
      const source = new EventSource('/api/download/events');
      sourceRef.current = source;
      source.onopen = () => {
        if (disposed) return;
        changeConnection('live');
        setError(null);
        void refresh();
      };
      const update = (event: MessageEvent) => {
        if (disposed) return;
        try {
          const data = JSON.parse(event.data) as Record<string, unknown>;
          const taskId = String(data.taskId ?? '');
          if (!taskId) return;
          setTasks((current) =>
            current.map((task) =>
              task.task_id === taskId
                ? {
                    ...task,
                    status:
                      typeof data.status === 'string'
                        ? data.status
                        : task.status,
                    progress:
                      typeof data.progress === 'number'
                        ? data.progress
                        : task.progress,
                    completed_bytes:
                      typeof data.completedBytes === 'number'
                        ? data.completedBytes
                        : task.completed_bytes,
                    updated_at: Date.now(),
                  }
                : task
            )
          );
          // Task 5 events intentionally carry compact deltas. Refresh the
          // trusted summary so counters and stage remain server-authored.
          void refresh();
        } catch {
          void refresh();
        }
      };
      for (const name of ['task.updated', 'episode.updated', 'segment.batch']) {
        source.addEventListener(name, update as EventListener);
      }
      source.addEventListener('task.removed', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as {
            taskId?: string;
          };
          setTasks((current) =>
            current.filter((task) => task.task_id !== data.taskId)
          );
        } catch {
          void refresh();
        }
      });
      source.addEventListener('snapshot.required', () => void refresh());
      source.onerror = () => {
        if (disposed) return;
        source.close();
        sourceRef.current = null;
        changeConnection('polling');
        void poll(modeGenerationRef.current);
        reconnectRef.current = window.setTimeout(() => {
          clearPolling();
          connect();
        }, 5000);
      };
    };

    void refresh().then(connect);
    const visibility = () => {
      if (connectionRef.current === 'polling') {
        clearPolling();
        void poll(modeGenerationRef.current);
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', visibility);
      sourceRef.current?.close();
      clearPolling();
      if (reconnectRef.current !== null)
        window.clearTimeout(reconnectRef.current);
    };
  }, [refresh]);

  const loadDetails = useCallback(async (taskId: string) => {
    return await responseJson<DownloadTaskDetail>(
      await fetch(`/api/download/${encodeURIComponent(taskId)}/detail`, {
        cache: 'no-store',
      })
    );
  }, []);

  const command = useCallback(
    async (taskId: string, action: DownloadCommandAction) => {
      await responseJson<unknown>(
        await fetch(`/api/download/${encodeURIComponent(taskId)}/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        })
      );
      await refresh();
    },
    [refresh]
  );

  return {
    tasks,
    connection,
    error,
    loading,
    loadDetails,
    command,
    refresh,
  };
}
