import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";

export type WsEvent = {
  id?: string;
  version?: string;
  type: string;
  source?: string;
  target?: string | null;
  payload: unknown;
  timestamp: string;
};

export type WsStatus = "connecting" | "connected" | "disconnected";

type SendPayload = {
  type: string;
  payload: unknown;
  target?: string | null;
};

type WebSocketContextValue = {
  status: WsStatus;
  events: WsEvent[];
  sendEvent: (envelope: SendPayload) => void;
};

const WebSocketContext = createContext<WebSocketContextValue>({
  status: "disconnected",
  events: [],
  sendEvent: () => {},
});

const MAX_EVENTS = 200;
const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;

function buildWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws`;
}

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<WsStatus>("connecting");
  const [events, setEvents] = useState<WsEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const unmountedRef = useRef(false);

  const pushEvents = useCallback((incoming: WsEvent[]) => {
    setEvents((prev) => {
      const combined = [...prev, ...incoming];
      return combined.length > MAX_EVENTS ? combined.slice(-MAX_EVENTS) : combined;
    });
  }, []);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    setStatus("connecting");
    const ws = new WebSocket(buildWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) { ws.close(); return; }
      attemptRef.current = 0;
      setStatus("connected");
    };

    ws.onmessage = (evt) => {
      if (unmountedRef.current) return;
      try {
        const data = JSON.parse(evt.data as string) as unknown;
        if (!data || typeof data !== "object") return;
        const msg = data as Record<string, unknown>;

        if (msg["type"] === "history.replay") {
          const payload = msg["payload"] as Record<string, unknown> | undefined;
          const evts = (payload?.["events"] as WsEvent[] | undefined) ?? [];
          if (evts.length > 0) pushEvents(evts);
          return;
        }

        if (typeof msg["type"] === "string" && msg["timestamp"]) {
          pushEvents([{
            id: msg["id"] as string | undefined,
            version: msg["version"] as string | undefined,
            type: msg["type"] as string,
            source: msg["source"] as string | undefined,
            target: msg["target"] as string | null | undefined,
            payload: msg["payload"],
            timestamp: msg["timestamp"] as string,
          }]);
        }
      } catch {
      }
    };

    ws.onerror = () => { ws.close(); };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      wsRef.current = null;
      setStatus("disconnected");
      const delay = Math.min(BASE_RECONNECT_MS * 2 ** attemptRef.current, MAX_RECONNECT_MS);
      attemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };
  }, [pushEvents]);

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  const sendEvent = useCallback((envelope: SendPayload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(envelope));
    }
  }, []);

  const value = useMemo(
    () => ({ status, events, sendEvent }),
    [status, events, sendEvent],
  );

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

export function useWebSocket() {
  return useContext(WebSocketContext);
}

export function useWsEvents(filter?: (e: WsEvent) => boolean): WsEvent[] {
  const { events } = useWebSocket();
  return useMemo(
    () => (filter ? events.filter(filter) : events),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events],
  );
}

export function useLatestEvent(type: string): WsEvent | null {
  const { events } = useWebSocket();
  return useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]!.type === type) return events[i]!;
    }
    return null;
  }, [events, type]);
}

export function useLatestPayload<T>(type: string): T | null {
  const event = useLatestEvent(type);
  return event ? (event.payload as T) : null;
}

/**
 * Returns a 0–1 activity level based on how many WebSocket events
 * arrived in the last 3 seconds.  0 = idle, 1 = 15+ events/3 s.
 *
 * A 500 ms interval tick forces the memo to recompute even when no new
 * events arrive, so activity decays naturally after bursts end.
 */
export function useActivityLevel(): number {
  const { events } = useWebSocket();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    const cutoff = Date.now() - 3000;
    const recent = events.filter(
      (e) => new Date(e.timestamp).getTime() > cutoff,
    ).length;
    return Math.min(recent / 15, 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, tick]);
}
