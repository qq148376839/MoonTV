/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getResourceDetector } from '@/lib/resource-detector';

export const runtime = 'nodejs'; // 需要文件系统访问，使用 Node.js runtime

/**
 * GET /api/local-resource - 检测本地资源是否存在
 */
export async function GET(request: NextRequest) {
  try {
    const resourceDetector = getResourceDetector();
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const id = searchParams.get('id');

    if (!source || !id) {
      return NextResponse.json(
        { error: '缺少必要参数: source 和 id' },
        { status: 400 }
      );
    }

    // 检查资源是否存在
    const resourceInfo = await resourceDetector.checkResource(source, id);

    if (!resourceInfo.exists) {
      return NextResponse.json(
        {
          exists: false,
          message: '资源不存在',
        },
        { status: 200 }
      );
    }

    // 返回资源信息
    return NextResponse.json(
      {
        exists: true,
        metadata: resourceInfo.metadata,
        local_path: resourceInfo.localPath,
        sources: resourceInfo.sources,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[Local Resource API] 检测资源失败:', error);
    return NextResponse.json(
      {
        error: '检测资源失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
