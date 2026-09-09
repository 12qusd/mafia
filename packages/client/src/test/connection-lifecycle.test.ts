import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conn } from '../ws/connection.js';
import { useStore } from '../store/store.js';
import { loadToken, saveToken } from '../lib/storage.js';
class MockSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: MockSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  frames: unknown[] = [];
  constructor() {
    MockSocket.instances.push(this);
  }
  send(raw: string) {
    this.frames.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  welcome(msg: object) {
    this.onmessage?.({ data: JSON.stringify({ v: 1, type: 'welcome', ...msg }) });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  MockSocket.instances = [];
  vi.stubGlobal('WebSocket', MockSocket);
  useStore.getState().resetAll();
});
afterEach(() => {
  conn.disconnect();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('connection lifecycle', () => {
  it('preserves the account credential when welcome contains a user ID', () => {
    saveToken('real-session-credential');
    conn.connect();
    const socket = MockSocket.instances[0]!;
    socket.open();
    socket.welcome({ userId: 'account-id' });
    expect(loadToken()).toBe('real-session-credential');
  });
  it('persists a newly issued guest credential for refresh and reconnect', () => {
    conn.connect();
    const socket = MockSocket.instances[0]!;
    socket.open();
    socket.welcome({ guestId: 'guest-id', token: 'guest-session-credential' });
    conn.reauth();
    const next = MockSocket.instances[1]!;
    next.open();
    expect(next.frames[0]).toMatchObject({ type: 'hello', token: 'guest-session-credential' });
  });
  it('ignores a late close from a socket disposed by React StrictMode', () => {
    conn.connect();
    const stale = MockSocket.instances[0]!;
    conn.disconnect();
    conn.connect();
    const current = MockSocket.instances[1]!;
    current.open();
    current.welcome({ guestId: 'current' });
    stale.onclose?.();
    expect(useStore.getState().connection).toBe('open');
    conn.send({ v: 1, type: 'ping', t: 42 });
    expect(current.frames.at(-1)).toEqual({ v: 1, type: 'ping', t: 42 });
  });
});
