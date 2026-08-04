import { EventSource } from "eventsource";

interface EventSourceOptions {
  url: string;
  headers?: Record<string, string>;
  /** Label used in log lines, so multiple streams stay distinguishable. */
  name: string;
  /**
   * Resume point for the first connection after a process restart. The library
   * resends `Last-Event-ID` automatically on in-process reconnects, but starts
   * from nothing on a fresh construct — so we seed the persisted value here.
   */
  initialLastEventId?: string;
  /** Called on every connection state change; drives the connected gauge. */
  onConnectionChange?: (connected: boolean) => void;
}

/**
 * A JSON-over-SSE stream whose handlers are keyed by the event map `T`, so
 * `on("unregistered", …)` receives a parsed `UnregisteredEvent` rather than the
 * raw string SSE actually delivers. The handler also receives the event's
 * `lastEventId` (the SSE `id:` field) so the caller can persist a resume cursor.
 */
export interface JsonEventSource<T> {
  on<K extends keyof T & string>(
    type: K,
    handler: (data: T[K], lastEventId: string) => void
  ): void;
  close(): void;
}

/**
 * Opens a JSON-over-SSE stream with the given headers.
 *
 * The stream is treated as infrastructure that must stay up: the underlying
 * library reconnects on its own and we never close it on error. Silently giving
 * up would mean losing the signal for the lifetime of the pod with nothing to
 * alert on — track `onConnectionChange` instead.
 */
export function createEventSource<T>({
  url,
  headers = {},
  name,
  initialLastEventId,
  onConnectionChange,
}: EventSourceOptions): JsonEventSource<T> {
  let connected = false;
  let seeded = false;

  const setConnected = (next: boolean) => {
    if (connected === next) return;
    connected = next;
    onConnectionChange?.(next);
  };

  const eventSource = new EventSource(url, {
    fetch: (input, init) => {
      const merged: Record<string, string> = {
        ...(init.headers as Record<string, string>),
        ...headers,
      };
      // Seed the resume point on the very first request only; after that the
      // library tracks Last-Event-ID itself from the events it receives.
      if (!seeded) {
        seeded = true;
        if (initialLastEventId && !merged["Last-Event-ID"]) {
          merged["Last-Event-ID"] = initialLastEventId;
        }
      }
      return fetch(input, { ...init, headers: merged });
    },
  });

  eventSource.onopen = () => {
    // Only log the transition, so a flapping upstream can't spam the log.
    if (!connected) console.log(`[${name}] connected to event stream`);
    setConnected(true);
  };

  eventSource.onerror = (error) => {
    if (connected) {
      console.error(`[${name}] event stream disconnected, reconnecting`, {
        readyState: eventSource.readyState,
        error,
      });
    }
    setConnected(false);
  };

  return {
    on: (type, handler) => {
      eventSource.addEventListener(type, ({ data, lastEventId }: MessageEvent<string>) => {
        let parsed: T[typeof type];

        // A malformed frame must not take down the stream, so parse defensively
        // and drop just that event.
        try {
          parsed = JSON.parse(data);
        } catch (error) {
          console.error(`[${name}] discarding unparseable "${type}" event`, { data, error });
          return;
        }

        handler(parsed, lastEventId);
      });
    },
    close: () => eventSource.close(),
  };
}
