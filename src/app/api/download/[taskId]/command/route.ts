import { NextRequest, NextResponse } from 'next/server';

import { CommandResult, getDownloadService } from '@/lib/download-service';
import { DownloadCommand } from '@/lib/download-types';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ taskId: string }> | { taskId: string };
};

const COMMANDS = new Set<DownloadCommand>([
  'pause',
  'resume',
  'cancel',
  'cancel_and_clean',
  'retry_failed',
  'prioritize',
]);

export async function POST(request: NextRequest, context: RouteContext) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: '请求体必须是 JSON 对象' },
      { status: 400 }
    );
  }
  const action = (body as { action?: unknown }).action;
  if (typeof action !== 'string' || !COMMANDS.has(action as DownloadCommand)) {
    return NextResponse.json({ error: '无效下载命令' }, { status: 400 });
  }

  const { taskId } = await context.params;
  const service = getDownloadService();
  let result: CommandResult;
  switch (action as DownloadCommand) {
    case 'pause':
      result = service.pauseTask(taskId);
      break;
    case 'resume':
      result = service.startResumeTask(taskId);
      break;
    case 'cancel':
      result = await service.cancelTask(taskId);
      break;
    case 'cancel_and_clean':
      result = await service.cancelTask(taskId, true);
      break;
    case 'retry_failed':
      result = await service.retryFailed(taskId);
      break;
    case 'prioritize':
      result = service.prioritizeTask(taskId);
      break;
  }

  if (!result.ok) {
    const status = result.status === 'not_found' ? 404 : 409;
    return NextResponse.json(
      { error: status === 404 ? '任务不存在' : '当前状态不允许该操作' },
      { status }
    );
  }
  return NextResponse.json({
    success: true,
    task_id: taskId,
    status: result.status,
  });
}
