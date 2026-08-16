export type DownloadStage =
  | 'queued'
  | 'preparing'
  | 'downloading'
  | 'validating'
  | 'committing'
  | 'completed'
  | 'pausing'
  | 'paused'
  | 'partial_failed'
  | 'cancelled_resumable'
  | 'recovery_wait';

export type DownloadUnitKind = 'segment' | 'key' | 'map';

export interface DownloadFailure {
  code: string;
  message: string;
  unitId?: string;
  retryable?: boolean;
  occurredAt: number;
}

export interface DownloadWorkItem {
  id: string;
  taskId: string;
  episodeId: string;
  generation: number;
  kind: DownloadUnitKind;
  stage: DownloadStage;
  index?: number;
  expectedBytes?: number | null;
  completedBytes: number;
  failure?: DownloadFailure;
}

export interface EpisodeDownloadState {
  taskId: string;
  episodeId: string;
  generation: number;
  stage: DownloadStage;
  totalSegments: number;
  completedSegments: number;
  failedSegments: number;
  activeSegments: number;
  totalKeys: number;
  completedKeys: number;
  failedKeys?: number;
  activeKeys?: number;
  totalMaps: number;
  completedMaps: number;
  failedMaps?: number;
  activeMaps?: number;
  completedBytes: number | null;
  expectedBytes: number | null;
  progress?: number;
  estimated?: boolean;
  bytesPerSecond?: number;
  etaSeconds?: number | null;
  failures: DownloadFailure[];
  legacyEntry: boolean;
  resumable: boolean;
  refreshCount: number;
  createdAt: number;
  updatedAt: number;
}

export type DownloadTaskStatus =
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'recovery_wait'
  | 'partial_completed'
  | 'completed'
  | 'failed'
  | 'cancelled_resumable';

export type DownloadPriority = 'normal' | 'high';

export interface DownloadTaskSnapshot {
  taskId: string;
  generation: number;
  status: DownloadTaskStatus;
  priority: DownloadPriority;
  episodes: EpisodeDownloadState[];
  totalEpisodes: number;
  completedEpisodes: number;
  failedEpisodes: number;
  activeEpisodes: number;
  completedBytes: number | null;
  expectedBytes: number | null;
  progress: number;
  estimated: boolean;
  bytesPerSecond?: number;
  etaSeconds?: number | null;
  failures: DownloadFailure[];
  legacyEntry: boolean;
  resumable: boolean;
  refreshCount: number;
  createdAt: number;
  updatedAt: number;
}

export type DownloadCommand =
  | { type: 'enqueue'; taskId: string; priority?: DownloadPriority }
  | {
      type: 'pause' | 'resume' | 'cancel' | 'retry' | 'recover' | 'refresh';
      taskId: string;
    };
