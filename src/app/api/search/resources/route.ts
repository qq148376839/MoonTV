import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';

export const runtime = 'edge';

// OrionTV 兼容接口：返回可用的搜索资源列表
export async function GET() {
  try {
    const cacheTime = await getCacheTime();

    // 由于搜索功能已独立化，这里返回基于环境变量配置的资源列表
    // 而不是从 config.json 中读取（config.json 中的搜索源已不再使用）
    const resources = [
      {
        key: 'official',
        name: '官方资源',
        api: process.env.NEXT_PUBLIC_OFFICIAL_SEARCH_URL || 'https://789jx.riowang.win',
        official_parser: true,
      },
      {
        key: 'unofficial',
        name: '非官方资源',
        api: process.env.NEXT_PUBLIC_UNOFFICIAL_SEARCH_URL || 'https://ss.riowang.win',
        official_parser: false,
      },
    ];

    return NextResponse.json(resources, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: '获取资源失败' }, { status: 500 });
  }
}
