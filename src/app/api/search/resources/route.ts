import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';

export const runtime = 'edge';

// OrionTV 兼容接口：返回可用的搜索资源列表
export async function GET() {
  try {
    const cacheTime = await getCacheTime();

    // OrionTV 兼容：这里返回“真实资源站 key”（应与 SearchResult.source 一致）
    // 不能返回 official/unofficial 这种分类，否则 /api/search/one 会拿到不准确/不可用的数据。
    // 注意：OrionTV 默认 enabledAll=true，会依赖该列表去逐源调用 /api/search/one。
    // 若该列表缺少某些非官方源（例如 ruyi），则 OrionTV 会出现“Web 端能搜到但 TV 端搜不到”的现象。
    const resources = [
      {
        key: '789caiji',
        name: '789采集（官方解析）',
        api: process.env.NEXT_PUBLIC_OFFICIAL_SEARCH_URL || 'https://789jx.riowang.win',
        official_parser: true,
      },
      // 非官方：多源聚合（与 /api/search/stream 返回的 source key 保持一致）
      // api 字段对 OrionTV 仅用于展示，不参与搜索逻辑（搜索由 /api/search/one 完成）。
      { key: 'ruyi', name: '如意资源（非官方）', api: '', official_parser: false },
      { key: 'jisu', name: '极速资源（非官方）', api: '', official_parser: false },
      { key: 'bfzy', name: '暴风资源（非官方）', api: '', official_parser: false },
      { key: 'tyyszy', name: '天涯资源（非官方）', api: '', official_parser: false },
      { key: 'ffzy', name: '非凡影视（非官方）', api: '', official_parser: false },
      { key: 'wolong', name: '卧龙资源（非官方）', api: '', official_parser: false },
      { key: 'zy360', name: '360资源（非官方）', api: '', official_parser: false },
      { key: 'heimuer', name: '黑木耳（非官方）', api: '', official_parser: false },
      { key: 'dyttzy', name: '电影天堂资源（非官方）', api: '', official_parser: false },
      { key: 'zuid', name: '最大资源（非官方）', api: '', official_parser: false },
      { key: 'lzi', name: '量子资源站（非官方）', api: '', official_parser: false },
      { key: 'wujin', name: '无尽资源（非官方）', api: '', official_parser: false },
      { key: 'yinghua', name: '樱花资源（非官方）', api: '', official_parser: false },
      { key: 'ikun', name: 'iKun资源（非官方）', api: '', official_parser: false },
      { key: 'maotaizy', name: '茅台资源（非官方）', api: '', official_parser: false },
      { key: 'mdzy', name: '魔都资源（非官方）', api: '', official_parser: false },
      { key: 'mozhua', name: '魔爪资源（非官方）', api: '', official_parser: false },
      { key: 'dbzy', name: '豆瓣资源（非官方）', api: '', official_parser: false },
      { key: 'dbzy5', name: '豆瓣资源5（非官方）', api: '', official_parser: false },
      { key: 'okzyw', name: 'OK资源网（非官方）', api: '', official_parser: false },
      { key: 'yayazy', name: '丫丫资源（非官方）', api: '', official_parser: false },
      { key: 'ckzy', name: '创客资源（非官方）', api: '', official_parser: false },
      { key: 'suoniapi', name: '锁你资源（非官方）', api: '', official_parser: false },
      { key: 'niuniuzy', name: '牛牛资源（非官方）', api: '', official_parser: false },
      { key: 'xjcj', name: '香蕉采集（非官方）', api: '', official_parser: false },
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
