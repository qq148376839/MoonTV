import { NextRequest, NextResponse } from 'next/server';

import { M3U8Cleaner } from '@/lib/m3u8-cleaner';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');

  if (!url) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return new NextResponse(`Failed to fetch source: ${response.status}`, {
        status: response.status,
      });
    }

    const contentType = response.headers.get('Content-Type');
    const content = await response.text();

    // Check if it's an M3U8 file
    if (
      (contentType && contentType.includes('application/vnd.apple.mpegurl')) ||
      (contentType && contentType.includes('application/x-mpegurl')) ||
      content.includes('#EXTM3U')
    ) {
      // Clean the M3U8 content
      const cleanedContent = M3U8Cleaner.clean(content, url);

      return new NextResponse(cleanedContent, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // If not M3U8, just return the content as is (or redirect?)
    // For now, let's proxy it but maybe we shouldn't use this endpoint for non-m3u8
    return new NextResponse(content, {
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Proxy error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
