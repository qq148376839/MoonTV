import { NextRequest } from 'next/server';

import {
  DownloadEvent,
  DownloadEventBus,
  getDownloadEventBus,
} from '@/lib/download-event-bus';
import { redactUrlsInText } from '@/lib/download-transaction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

function safeData(value: unknown): unknown {
  if (typeof value === 'string') return redactUrlsInText(value);
  if (Array.isArray(value)) return value.map(safeData);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, safeData(child)])
    );
  }
  return value;
}

function encodeEvent(event: DownloadEvent): Uint8Array {
  return encoder.encode(
    `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(
      safeData(event.data)
    )}\n\n`
  );
}

export function createDownloadEventResponse(
  request: NextRequest,
  bus: DownloadEventBus = getDownloadEventBus()
): Response {
  const header = request.headers.get('last-event-id');
  const lastEventId = header === null ? null : Number(header);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: () => void = () => undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // The consumer may already have closed the stream.
        }
      };
      request.signal.addEventListener('abort', close, { once: true });

      const replay = lastEventId === null ? [] : bus.since(Number(lastEventId));
      if (lastEventId === null || replay === null) {
        controller.enqueue(
          encoder.encode(
            `event: snapshot.required\ndata: ${JSON.stringify({
              reason: lastEventId === null ? 'initial' : 'replay_unavailable',
              revision: bus.latestId(),
            })}\n\n`
          )
        );
      } else {
        replay.forEach((event) => controller.enqueue(encodeEvent(event)));
      }
      unsubscribe = bus.subscribe((event) => {
        if (!closed) controller.enqueue(encodeEvent(event));
      });
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 15_000);
    },
    cancel() {
      closed = true;
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export function GET(request: NextRequest) {
  return createDownloadEventResponse(request);
}
