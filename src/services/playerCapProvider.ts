import type { PlayerCapConnectionStatus, PlayerCapEvent, PlayerCapServiceStatusData } from '../types/playerCap';

// PlayerCap WS consumer (thin I/O shell): first GET /service-status to probe (fetch player list/config), then connect WS;
// retry repeatedly until connected (guards against "open OBS before PlayerCap"), and keep reconnecting after drops. Event parsing is reduced by playerCapSession.

const DEFAULT_HOST = 'localhost:8765';
const RECONNECT_DELAY_MS = 2000;
const SERVICE_STATUS_TIMEOUT_MS = 2000;

// buildPlayerCapWsUrl("h:8765") → ws://h:8765/ws; with player → ws://h:8765/{player}/ws (pins that player).
export function buildPlayerCapWsUrl(host: string, player?: string): string {
  const h = host || DEFAULT_HOST;
  return player ? `ws://${h}/${player}/ws` : `ws://${h}/ws`;
}

// GET http://{host}/service-status (2s timeout); returns null on failure. Response body shaped like { code, msg, data }.
export async function fetchPlayerCapServiceStatus(host: string): Promise<PlayerCapServiceStatusData | null> {
  const h = host || DEFAULT_HOST;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERVICE_STATUS_TIMEOUT_MS);
    const resp = await fetch(`http://${h}/service-status`, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const json = (await resp.json()) as { data?: PlayerCapServiceStatusData };
    return json?.data ?? null;
  } catch {
    return null;
  }
}

export interface PlayerCapProviderCallbacks {
  onConnectionStatusChange?: (status: PlayerCapConnectionStatus) => void;
  onServiceStatus?: (data: PlayerCapServiceStatusData) => void;
  onEvent?: (event: PlayerCapEvent) => void;
  onDisconnect?: () => void; // fires once when an established connection unexpectedly drops (for UI notice); reconnection still continues afterward
  debug?: boolean;
}

export interface PlayerCapProviderOptions {
  host?: string;
  player?: string;
}

export class PlayerCapProvider {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private connectedOnce = false;
  // Generation token: incremented on every start/stop/restart, invalidating any in-flight async probe (the post-await continuation of openSocket),
  // thereby serializing connections and avoiding concurrent probes and socket leaks when host/player change simultaneously.
  private generation = 0;
  private _host: string;
  private _player: string;
  private readonly callbacks: PlayerCapProviderCallbacks;

  constructor(callbacks: PlayerCapProviderCallbacks = {}, options: PlayerCapProviderOptions = {}) {
    this.callbacks = callbacks;
    this._host = options.host || DEFAULT_HOST;
    this._player = options.player || '';
  }

  get host(): string { return this._host; }
  set host(value: string) {
    const next = value || DEFAULT_HOST;
    if (next === this._host) return; // unchanged value: don't restart, avoid needless probing/connection churn
    this._host = next;
    this.restartIfActive();
  }

  get player(): string { return this._player; }
  set player(value: string) {
    const next = value || '';
    if (next === this._player) return;
    this._player = next;
    this.restartIfActive();
  }

  start(): void {
    this.stopped = false;
    this.generation += 1;
    this.clearReconnectTimer();
    void this.openSocket(this.generation);
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.clearReconnectTimer();
    this.closeSocket();
    this.connectedOnce = false;
    this.setStatus('idle');
  }

  destroy(): void {
    this.stop();
  }

  private restartIfActive(): void {
    if (this.stopped) return;
    this.generation += 1;
    this.clearReconnectTimer();
    this.closeSocket();
    void this.openSocket(this.generation);
  }

  private async openSocket(generation: number): Promise<void> {
    if (this.stopped || this.ws) return;

    // Probe over HTTP first; if unreachable, retry later (don't open a WS yet, to avoid needless connection churn).
    this.setStatus('probing');
    const status = await fetchPlayerCapServiceStatus(this._host);
    if (this.stopped || generation !== this.generation) return; // superseded by a later start/stop/restart
    if (!status) {
      this.setStatus('unreachable');
      this.scheduleReconnect();
      return;
    }
    this.callbacks.onServiceStatus?.(status);

    this.setStatus('connecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(buildPlayerCapWsUrl(this._host, this._player));
    } catch (err) {
      if (this.callbacks.debug) console.warn('[PlayerCap] WS creation failed', err);
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.connectedOnce = true;
      this.setStatus('connected');
    };
    socket.onmessage = (ev) => this.handleMessage(ev.data);
    socket.onerror = () => {
      if (this.callbacks.debug) console.warn('[PlayerCap] WS error');
    };
    socket.onclose = () => {
      this.ws = null;
      if (this.stopped) return;
      if (this.connectedOnce) {
        this.connectedOnce = false;
        this.callbacks.onDisconnect?.();
      }
      this.setStatus('disconnected');
      this.scheduleReconnect();
    };
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let event: PlayerCapEvent;
    try {
      event = JSON.parse(raw) as PlayerCapEvent;
    } catch (err) {
      if (this.callbacks.debug) console.warn('[PlayerCap] message parse failed', err);
      return;
    }
    if (!event || typeof event.type !== 'string') return;
    this.callbacks.onEvent?.(event);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket(this.generation);
    }, RECONNECT_DELAY_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private setStatus(status: PlayerCapConnectionStatus): void {
    this.callbacks.onConnectionStatusChange?.(status);
  }
}
