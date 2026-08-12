type Listener = (event: { data?: string }) => void;

/** Minimal WebSocket stand-in for tests: install with
 * `vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)`,
 * drive it with `.open()`/`.message()`/`.close()`, and inspect `.sent`. */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  readonly url: string;
  readonly sent: string[] = [];
  private readonly listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(): void {
    // not needed for these tests
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch('close', {});
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch('open', {});
  }

  message(payload: unknown): void {
    this.dispatch('message', { data: JSON.stringify(payload) });
  }

  private dispatch(type: string, event: { data?: string }): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

export function latestFakeSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (socket === undefined) throw new Error('no FakeWebSocket was created');
  return socket;
}
