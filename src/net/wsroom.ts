import type { Action, GameView } from '../engine/game';
import { myToken, type Member } from './online';

/**
 * サーバー型のオンライン対戦（WebSocket）。
 * ゲームの進行はサーバー（Cloudflare Workers / Durable Objects）が行うので、
 * ルームを作った人がアプリを閉じても対局は続く。
 * VITE_SERVER_URL が設定されているときに使う（未設定なら従来の P2P 方式）。
 */
export const SERVER_URL: string = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');
export const useServer = SERVER_URL !== '';

type ServerMsg =
  | { t: 'lobby'; code: string; members: Member[]; youAreHost: boolean }
  | { t: 'view'; v: GameView }
  | { t: 'error'; msg: string; fatal?: boolean }
  | { t: 'pong' };

export async function createRoomCode(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error(`サーバーに接続できませんでした（${res.status}）`);
  const { code } = (await res.json()) as { code: string };
  return code;
}

export class WsRoom {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private retries = 0;
  private ping: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  onLobby: (members: Member[], youAreHost: boolean) => void = () => {};
  onView: (v: GameView) => void = () => {};
  onError: (msg: string, fatal: boolean) => void = () => {};
  onClosed: () => void = () => {};
  onConnection: (connected: boolean) => void = () => {};

  constructor(public name: string, public code: string) {
    document.addEventListener('visibilitychange', this.onWake);
    window.addEventListener('online', this.onWake);
  }

  private ready: { resolve: () => void; reject: (e: Error) => void } | null = null;

  /** 最初の応答（ロビーか盤面）が来たら resolve */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.ready) { this.ready = null; reject(new Error('接続がタイムアウトしました')); }
      }, 15000);
      this.ready = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
      this.open();
    });
  }

  private open() {
    if (this.closedByUser) return;
    const url = `${SERVER_URL.replace(/^http/, 'ws')}/api/rooms/${this.code}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.onConnection(true);
      ws.send(JSON.stringify({ t: 'hello', name: this.name, token: myToken() }));
      if (this.ping) clearInterval(this.ping);
      // 回線の途中で切られないよう定期的に通信する
      this.ping = setInterval(() => this.send({ t: 'ping' }), 20000);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.t === 'error') {
        if (msg.fatal) this.closedByUser = true;
        if (msg.fatal && this.ready) { this.ready.reject(new Error(msg.msg)); this.ready = null; }
        else this.onError(msg.msg, !!msg.fatal);
        return;
      }
      if (msg.t === 'pong') return;
      if (this.ready) { this.ready.resolve(); this.ready = null; }
      if (msg.t === 'lobby') this.onLobby(msg.members, msg.youAreHost);
      else if (msg.t === 'view') this.onView(msg.v);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.ping) clearInterval(this.ping);
      this.ping = null;
      if (this.closedByUser) return;
      this.onConnection(false);
      // 自動再接続（同じトークンで同じ席に戻る）
      if (this.retries++ >= 40) { this.onClosed(); return; }
      const delay = Math.min(8000, 500 * 2 ** Math.min(this.retries, 4));
      this.reconnectTimer = setTimeout(() => this.open(), delay);
    };
  }

  /** アプリ復帰・回線復帰時はすぐ再接続 */
  private onWake = () => {
    if (document.hidden || this.closedByUser) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.retries = 0;
    this.open();
  };

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  start(length: 'tonpu' | 'hanchan', count: 3 | 4) {
    this.send({ t: 'start', length, count });
  }

  act(a: Action) {
    this.send({ t: 'act', a });
  }

  close() {
    this.closedByUser = true;
    document.removeEventListener('visibilitychange', this.onWake);
    window.removeEventListener('online', this.onWake);
    if (this.ping) clearInterval(this.ping);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
