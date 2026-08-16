import { NextRequest, NextResponse } from 'next/server';

import { getDownloadService } from '@/lib/download-service';

import { detailDownloadTask } from '../../public-view';

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
  return NextResponse.json(detailDownloadTask(snapshot));
}
