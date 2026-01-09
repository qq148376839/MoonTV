import { NextResponse } from 'next/server';

import { getAvailableApiSites, getCacheTime } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';

export const runtime = 'nodejs'; // 需要使用 config.ts，改为 Node.js runtime

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const sourceCode = searchParams.get('source');

  if (!id || !sourceCode) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
  }

  if (!/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: '无效的视频ID格式' }, { status: 400 });
  }

  try {
    // 检查是否是官方或非官方资源（这些资源不需要从配置中查找）
    if (sourceCode === 'official' || sourceCode === 'unofficial') {
      return NextResponse.json(
        {
          error:
            '官方和非官方资源已在搜索结果中包含完整信息，无需调用详情接口',
        },
        { status: 400 }
      );
    }

    const apiSites = await getAvailableApiSites();
    const apiSite = apiSites.find((site) => site.key === sourceCode);

    // 如果不在配置列表中，也允许通过（可能是新的搜索源）
    if (!apiSite) {
      // 对于不在配置中的源，返回提示信息
      // 这些资源应该已经在搜索结果中包含了完整信息
      return NextResponse.json(
        {
          error: `源 "${sourceCode}" 不在配置列表中。该资源应在搜索结果中已包含完整信息，无需调用详情接口。`,
        },
        { status: 400 }
      );
    }

    const result = await getDetailFromApi(apiSite, id, request.url);
    const cacheTime = await getCacheTime();

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
