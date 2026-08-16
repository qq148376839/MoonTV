import { NextRequest, NextResponse } from 'next/server';

import { getDownloadService } from '@/lib/download-service';
import { redactUrlsInText } from '@/lib/download-transaction';
import { DownloadAddressSource } from '@/lib/download-types';
import {
  EpisodeDownloadAuditSummary,
  getStorageManager,
} from '@/lib/local-storage';

import { detailDownloadTask, PublicAdFilterSummary } from '../../public-view';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ taskId: string }> | { taskId: string };
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { taskId } = await context.params;
  const snapshot = getDownloadService().getSnapshot(taskId);
  if (!snapshot) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  const adFilterByEpisode: Record<string, PublicAdFilterSummary> = {};
  const addressSourceByEpisode: Record<string, DownloadAddressSource> = {};
  const safeAddressSources = new Set<DownloadAddressSource>([
    'direct',
    'parsed',
    'refreshed',
    'client_fallback',
    'historical_fallback',
  ]);
  try {
    const storage = getStorageManager();
    const resourcePath = storage.getResourcePath(
      snapshot.title,
      snapshot.year,
      snapshot.source,
      snapshot.resourceId
    );
    const audits = storage.readMetadata(resourcePath)?.episode_audits ?? {};
    for (const episode of Object.values(snapshot.episodes)) {
      const audit: EpisodeDownloadAuditSummary | undefined =
        audits[String(episode.episode)];
      if (!audit || audit.generation_id !== episode.generationId) continue;
      if (safeAddressSources.has(audit.address_method)) {
        addressSourceByEpisode[String(episode.episode)] = audit.address_method;
      }
      adFilterByEpisode[String(episode.episode)] = {
        original_segments: audit.original_segments,
        removed_segments: audit.removed_segments,
        final_segments: audit.final_segments,
        removed_duration_seconds: audit.removed_duration_sec,
        filter_version: audit.filter_version,
        reason: audit.filter_reason
          ? redactUrlsInText(audit.filter_reason)
          : undefined,
        matched_reasons: audit.filter_reasons?.map(redactUrlsInText),
        validation_passed: audit.validation_passed,
      };
    }
  } catch {
    // Detail remains available when legacy metadata is absent or unreadable.
  }
  const scheduler = getDownloadService().getSchedulerDiagnostics();
  return NextResponse.json(
    detailDownloadTask(
      snapshot,
      adFilterByEpisode,
      {
        globalConcurrency: scheduler.concurrency,
        globalActive: scheduler.active,
      },
      addressSourceByEpisode
    )
  );
}
