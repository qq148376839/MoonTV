import { NextRequest, NextResponse } from 'next/server';

import { getDownloadService } from '@/lib/download-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ taskId: string }> | { taskId: string };
};

export async function GET(request: NextRequest, context: RouteContext) {
  const episode = Number.parseInt(
    request.nextUrl.searchParams.get('episode') ?? '',
    10
  );
  if (!Number.isInteger(episode) || episode < 1) {
    return NextResponse.json({ error: '无效剧集编号' }, { status: 400 });
  }

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
  if (playback.status === 'completed') {
    const target = new URL('/api/local-video', request.nextUrl.origin);
    target.searchParams.set('path', playback.playlistPath);
    return new NextResponse(null, {
      status: 302,
      headers: { Location: target.href },
    });
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
