/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs'; // 需要使用 config.ts，改为 Node.js runtime

export async function GET(request: NextRequest) {
  console.log('server-config called: ', request.url);

  const config = await getConfig();
  const result = {
    SiteName: config.SiteConfig.SiteName,
    StorageType: process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage',
    SourceConfig: config.SourceConfig || [], // 添加 SourceConfig
  };
  console.log('[server-config] 返回配置:', {
    SiteName: result.SiteName,
    SourceConfigCount: result.SourceConfig.length,
    OfficialParserSources: result.SourceConfig.filter(
      (s: { official_parser?: boolean; key: string }) => s.official_parser
    ).map((s: { key: string }) => s.key),
  });
  return NextResponse.json(result);
}
