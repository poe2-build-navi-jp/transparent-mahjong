import type { Action, GameView } from '../engine/game';
import { DEFAULT_RULES, sanitizeRules, type Rules } from '../engine/rules';
import { myToken, type Member } from './online';

/**
 * サーバー型のオンライン対戦（WebSocket）。
 * ゲームの進行はサーバー（Cloudflare Workers / Durable Objects）が行うので、
 * ルームを作った人がアプリを閉じても対局は続く。
 * 使うサーバーは次の順で決める:
 *   1. ページと同じ場所にサーバーがあればそれ（Cloudflare で画面とサーバーを一緒に公開した場合）
 *   2. ビルド時の VITE_SERVER_URL（GitHub Pages やアプリから別の場所のサーバーへつなぐ場合）
 *   3. どちらもなければ従来の P2P 方式
 */
let SERVER_URL: string = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');
export let useServer = SERVER_URL !== '';

/** 起動時に一度だけ呼ぶ。同じ場所にサーバーがあるか確かめる */
export async function detectServer(): Promise<void> {
  if (!/^https?:$/.test(location.protocol)) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${location.origin}/api/health`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (res.ok && (await res.json() as { ok?: boolean }).ok) {
      SERVER_URL = location.origin;
      useServer = true;
    }
  } catch { /* 同じ場所にサーバーはない */ }
}

type ServerMsg =
  | { t: 'lobby'; code: string; members: Member[]; youAreHost: boolean; rules?: Rules }
  | { t: 'view'; v: GameView }
  | { t: 'error'; msg: string; fatal?: boolean; code?: string }
  | { t: 'pong' };

export interface QuotaStatus {
  premium: boolean;
  used: number;
  /** 1日あたりの無料対局数（0 = 無制限） */
  limit: number;
  /** 本日の残り（null = 無制限） */
  remaining: number | null;
}

/** 本日の無料オンライン対局の残り。サーバーがない・古い場合は null */
export async function fetchQuota(): Promise<QuotaStatus | null> {
  if (!useServer) return null;
  try {
    const res = await fetch(`${SERVER_URL}/api/quota?token=${encodeURIComponent(myToken())}`, { cache: 'no-store' });
    return res.ok ? (await res.json()) as QuotaStatus : null;
  } catch {
    return null;
  }
}

export async function createRoomCode(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/rooms`, { method: 'POST' });
  if (res.status === 429) throw new Error('ルームの作成が多すぎます。少し時間をおいてください');
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
  onLobby: (members: Member[], youAreHost: boolean, rules: Rules) => void = () => {};
  onView: (v: GameView) => void = () => {};
  onError: (msg: string, fatal: boolean, code?: string) => void = () => {};
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
        else this.onError(msg.msg, !!msg.fatal, msg.code);
        return;
      }
      if (msg.t === 'pong') return;
      if (this.ready) { this.ready.resolve(); this.ready = null; }
      if (msg.t === 'lobby') this.onLobby(msg.members, msg.youAreHost, sanitizeRules(msg.rules ?? DEFAULT_RULES));
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

  /** ホストのみ: ルールを変更（参加者の画面にも反映される） */
  setRules(rules: Rules) {
    this.send({ t: 'rules', rules });
  }

  start(rules: Rules) {
    this.send({ t: 'start', rules, length: rules.length, count: rules.count });
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
