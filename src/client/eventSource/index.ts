import { EventSource } from "eventsource";

interface EventSourceOptions {
  url: string;
  headers?: Record<string, string>;
  /** Label used in log lines, so multiple streams stay distinguishable. */
  name: string;
  /** Called on every connection state change; drives the connected gauge. */
  onConnectionChange?: (connected: boolean) => void;
}

/**
 * A JSON-over-SSE stream whose handlers are keyed by the event map `T`, so
 * `on("unregistered", …)` receives a parsed `UnregisteredEvent` rather than the
 * raw string SSE actually delivers.
 */
export interface JsonEventSource<T> {
  on<K extends keyof T & string>(type: K, handler: (data: T[K]) => void): void;
  close(): void;
}

/**
 * Opens a JSON-over-SSE stream with the given headers.
 *
 * The stream is treated as infrastructure that must stay up: the underlying
 * library reconnects on its own and we never close it on error. Silently giving
 * up would mean losing the signal for the lifetime of the pod with nothing to
 * alert on — track `onConnectionChange` instead. On each reconnect the server
 * re-sends a full state snapshot, so nothing needs to be resumed client-side.
 */
export function createEventSource<T>({
  url,
  headers = {},
  name,
  onConnectionChange,
}: EventSourceOptions): JsonEventSource<T> {
  let connected = false;

  const setConnected = (next: boolean) => {
    if (connected === next) return;
    connected = next;
    onConnectionChange?.(next);
  };

  const eventSource = new EventSource(url, {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        headers: { ...init.headers, ...headers },
      }),
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
      eventSource.addEventListener(type, ({ data }: MessageEvent<string>) => {
        let parsed: T[typeof type];

        // A malformed frame must not take down the stream, so parse defensively
        // and drop just that event.
        try {
          parsed = JSON.parse(data);
        } catch (error) {
          console.error(`[${name}] discarding unparseable "${type}" event`, { data, error });
          return;
        }

        handler(parsed);
      });
    },
    close: () => eventSource.close(),
  };
}
