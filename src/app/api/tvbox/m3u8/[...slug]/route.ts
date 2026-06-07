import { NextRequest } from 'next/server';

import { GET as parentGET, OPTIONS as parentOPTIONS } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Catch-all route: /api/tvbox/m3u8/play.m3u8?source=X&id=Y&episode=Z
// Forwards to the parent m3u8 handler with same query params
export async function GET(request: NextRequest) {
  return parentGET(request);
}

export async function OPTIONS() {
  return parentOPTIONS();
}
