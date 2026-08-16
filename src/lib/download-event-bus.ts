export type DownloadEventType =
  | 'task.updated'
  | 'episode.updated'
  | 'segment.batch'
  | 'task.removed';

export interface DownloadEvent {
  id: number;
  type: DownloadEventType;
  data: unknown;
  createdAt: number;
}

type DownloadEventListener = (event: DownloadEvent) => void;

export class DownloadEventBus {
  private nextId = 1;
  private readonly events: DownloadEvent[] = [];
  private readonly listeners = new Set<DownloadEventListener>();

  constructor(private readonly capacity = 1000) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('event buffer capacity must be a positive integer');
    }
  }

  publish(type: DownloadEventType, data: unknown): DownloadEvent {
    const event: DownloadEvent = {
      id: this.nextId,
      type,
      data,
      createdAt: Date.now(),
    };
    this.nextId += 1;
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.shift();
    for (const listener of this.listeners) listener(event);
    return event;
  }

  subscribe(listener: DownloadEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  since(lastEventId: number): DownloadEvent[] | null {
    if (!Number.isSafeInteger(lastEventId) || lastEventId < 0) return null;
    if (this.events.length === 0) return [];
    const firstId = this.events[0].id;
    const latestId = this.events[this.events.length - 1].id;
    if (lastEventId < firstId - 1 || lastEventId > latestId) return null;
    return this.events.filter((event) => event.id > lastEventId);
  }

  latestId(): number {
    return this.nextId - 1;
  }
}

const globalDownloadEventBus = new DownloadEventBus(1000);

export function getDownloadEventBus(): DownloadEventBus {
  return globalDownloadEventBus;
}
