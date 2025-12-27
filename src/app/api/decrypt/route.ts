/**
 * 官方解析器解密API
 * 参考 final_direct_parser_v2.py 的实现
 */
/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { decryptEpisodeUrl } from '@/lib/decrypt';

// 使用 Node.js Runtime，因为解密需要 Node.js crypto 模块
export const runtime = 'nodejs';

interface DecryptRequest {
  parserUrl: string; // 解析器URL（来自detail字段）
  videoUrl: string; // 原始视频URL
}

// DecryptResponse interface is used in return types
// eslint-disable-next-line unused-imports/no-unused-vars
interface DecryptResponse {
  success: boolean;
  m3u8Url?: string;
  error?: string;
  cached?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body: DecryptRequest = await request.json();

    // 验证输入
    if (!body.parserUrl || !body.videoUrl) {
      return NextResponse.json(
        {
          success: false,
          error: '参数缺失：parserUrl 和 videoUrl 都是必需的',
        },
        { status: 400 }
      );
    }

    // 调用内部解密函数（decryptEpisodeUrl 内部已处理缓存）
    const m3u8Url = await decryptEpisodeUrl(body.parserUrl, body.videoUrl);

    // 检查是否返回了原始 URL（表示解密失败）
    if (m3u8Url === body.videoUrl) {
      return NextResponse.json(
        {
          success: false,
          error: '解密失败，返回原始URL',
          m3u8Url: m3u8Url, // 仍然返回原始URL，让客户端决定如何处理
        },
        { status: 200 } // 返回200而不是500，保持向后兼容
      );
    }

    // 解密成功
    return NextResponse.json({
      success: true,
      m3u8Url,
      cached: false, // decryptEpisodeUrl 内部处理缓存，这里不区分是否缓存
    });
  } catch (error) {
    console.error('[decrypt API] 解密失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '解密失败，请稍后重试',
      },
      { status: 500 }
    );
  }
}
