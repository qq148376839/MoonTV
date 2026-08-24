import { NextRequest, NextResponse } from 'next/server';

import { getDownloadService } from '@/lib/download-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ taskId: string }> | { taskId: string };
};

export async function GET(request: NextRequest, context: RouteContext) {
  const episodeValue = request.nextUrl.searchParams.get('episode') ?? '';
  if (!/^[1-9]\d*$/.test(episodeValue)) {
    return NextResponse.json({ error: '无效剧集编号' }, { status: 400 });
  }
  const episode = Number(episodeValue);

  const { taskId } = await context.params;
  const playback = getDownloadService().getProgressivePlayback(taskId, episode);
  if (playback.status === 'not_found') {
    return NextResponse.json(
      { error: '下载任务或剧集不存在' },
      { status: 404 }
    );
  }
  if (playback.status === 'not_ready') {
    return NextResponse.json(
      { error: '首个连续分片尚未准备完成' },
      { status: 409, headers: { 'Retry-After': '2' } }
    );
  }
  return new NextResponse(playback.content, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Playable-Segments': String(playback.segmentCount),
      'X-Playable-Duration': String(playback.durationSeconds),
    },
  });
}
