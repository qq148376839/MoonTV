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

export type DownloadAddressSource =
  | 'direct'
  | 'parsed'
  | 'refreshed'
  | 'client_fallback'
  | 'historical_fallback';

export interface DownloadFailure {
  kind: DownloadUnitKind;
  index: number;
  category:
    | 'timeout'
    | 'http_auth'
    | 'http_server'
    | 'io'
    | 'empty'
    | 'length'
    | 'other';
  attempts: number;
  path: string;
  message: string;
}

export interface DownloadWorkItem {
  taskId: string;
  episode: number;
  generationId: string;
  kind: DownloadUnitKind;
  index: number;
  attempt: number;
  speedBytesPerSecond?: number;
}

export interface EpisodeDownloadState {
  episode: number;
  generationId: string;
  stage: DownloadStage;
  totalSegments: number;
  completedSegmentIndices: number[];
  failedSegmentIndices: number[];
  activeItems: DownloadWorkItem[];
  keyTotal: number;
  keyCompleted: number;
  mapTotal: number;
  mapCompleted: number;
  completedBytes: number;
  estimatedBytes: number | null;
  progress: number;
  progressEstimated: boolean;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  failures: DownloadFailure[];
  oldEntryRetained: boolean;
  recoverable: boolean;
  refreshCount: number;
  addressSource?: DownloadAddressSource;
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

export interface DownloadRecoveryRecipe {
  source: string;
  resourceId: string;
  episodeEntries: Record<string, string>;
  episodeHeaders?: Record<string, Record<string, string>>;
}

export interface DownloadTaskSnapshot {
  schemaVersion: 1;
  taskId: string;
  source: string;
  resourceId: string;
  title: string;
  year: string;
  poster?: string;
  recovery?: DownloadRecoveryRecipe;
  episodeNumbers: number[];
  status: DownloadTaskStatus;
  priority: 'normal' | 'high';
  currentEpisode: number | null;
  progress: number;
  progressEstimated: boolean;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  completedBytes: number;
  createdAt: number;
  updatedAt: number;
  episodes: Record<string, EpisodeDownloadState>;
}

export type DownloadCommand =
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'cancel_and_clean'
  | 'retry_failed'
  | 'prioritize';
