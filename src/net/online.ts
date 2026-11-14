import Peer, { type DataConnection } from 'peerjs';
import type { Action, GameView } from '../engine/game';
import { GameHost } from './host';

/**
 * オンライン対戦（P2P / WebRTC）。
 * ルームを作った端末がホスト（権威サーバー）となり、ルームコードを PeerJS の ID に使う。
 * 参加者はコードを入力してホストへ直接接続する。サーバー不要で動作する。
 */

const PREFIX = 'tmj-room-';

/**
 * シグナリングサーバーの設定。既定は PeerJS の公開サーバー。
 * 自前サーバーを使う場合はビルド時に VITE_PEER_HOST / VITE_PEER_PORT / VITE_PEER_PATH / VITE_PEER_SECURE を指定する。
 */
function peerOptions() {
  const env = import.meta.env;
  const o: Record<string, unknown> = { debug: 0 };
  if (env.VITE_PEER_HOST) {
    o.host = env.VITE_PEER_HOST;
    o.port = Number(env.VITE_PEER_PORT || 443);
    o.path = env.VITE_PEER_PATH || '/';
    o.secure = env.VITE_PEER_SECURE !== 'false';
  }
  return o;
}
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode(): string {
  const r = new Uint32Array(6);
  crypto.getRandomValues(r);
  return Array.from(r, (v) => CODE_CHARS[v % CODE_CHARS.length]).join('');
}

export function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function myToken(): string {
  try {
    let t = localStorage.getItem('tmj-token');
    if (!t) {
      t = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('tmj-token', t);
    }
    return t;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export interface Member {
  name: string;
  host: boolean;
}

type ClientMsg = { t: 'hello'; name: string; token: string } | { t: 'act'; a: Action };
type HostMsg =
  | { t: 'lobby'; members: Member[]; code: string }
  | { t: 'view'; v: GameView }
  | { t: 'error'; msg: string }
  | { t: 'closed' };

interface Guest {
  name: string;
  token: string;
  conn: DataConnection | null;
  seat: number;
}

// ---------------------------------------------------------------- ホスト

export class RoomHost {
  peer!: Peer;
  code = '';
  guests: Guest[] = [];
  host: GameHost | null = null;
  onLobby: (members: Member[]) => void = () => {};
  onView: (v: GameView) => void = () => {};
  onError: (msg: string) => void = () => {};
  private hostSeat = 0;

  constructor(public name: string) {}

  open(): Promise<string> {
    return new Promise((resolve, reject) => {
      const tryOpen = (attempt: number) => {
        const code = makeCode();
        const peer = new Peer(PREFIX + code, peerOptions());
        peer.on('open', () => {
          this.peer = peer;
          this.code = code;
          peer.on('connection', (c) => this.accept(c));
          resolve(code);
        });
        peer.on('error', (e: Error & { type?: string }) => {
          if (e.type === 'unavailable-id' && attempt < 5) {
            peer.destroy();
            tryOpen(attempt + 1);
          } else if (!this.code) {
            reject(e);
          } else {
            this.onError(String(e.message ?? e));
          }
        });
        peer.on('disconnected', () => {
          // シグナリングサーバーとの接続が切れても既存のP2P接続は生きているので再接続を試みる
          if (!peer.destroyed) peer.reconnect();
        });
      };
      tryOpen(0);
    });
  }

  members(): Member[] {
    return [{ name: this.name, host: true }, ...this.guests.map((g) => ({ name: g.name, host: false }))];
  }

  private broadcastLobby() {
    const members = this.members();
    this.onLobby(members);
    for (const g of this.guests) this.sendTo(g.conn, { t: 'lobby', members, code: this.code });
  }

  private sendTo(conn: DataConnection | null, msg: HostMsg) {
    if (conn && conn.open) conn.send(msg);
  }

  private accept(conn: DataConnection) {
    conn.on('data', (raw) => {
      const msg = raw as ClientMsg;
      if (msg.t === 'hello') {
        const name = String(msg.name || 'ゲスト').slice(0, 12);
        const existing = this.guests.find((g) => g.token === msg.token);
        if (existing) {
          existing.conn = conn;
          existing.name = name;
          if (this.host) this.host.setLink(existing.seat, { send: (v) => this.sendTo(conn, { t: 'view', v }) });
          else this.broadcastLobby();
          return;
        }
        if (this.host) {
          this.sendTo(conn, { t: 'error', msg: 'この対局はすでに開始しています' });
          return;
        }
        if (this.guests.length >= 3) {
          this.sendTo(conn, { t: 'error', msg: 'ルームが満員です' });
          return;
        }
        this.guests.push({ name, token: msg.token, conn, seat: -1 });
        this.broadcastLobby();
      } else if (msg.t === 'act') {
        const g = this.guests.find((x) => x.conn === conn);
        if (g && this.host && g.seat >= 0) this.host.action(g.seat, msg.a);
      }
    });
    conn.on('close', () => {
      const g = this.guests.find((x) => x.conn === conn);
      if (!g) return;
      g.conn = null;
      if (this.host) {
        if (g.seat >= 0) this.host.disconnect(g.seat);
      } else {
        this.guests = this.guests.filter((x) => x !== g);
        this.broadcastLobby();
      }
    });
  }

  /** 空席は CPU で埋めて開始。席順はランダム */
  start(length: 'tonpu' | 'hanchan', count: 3 | 4 = 4) {
    this.guests = this.guests.slice(0, count - 1);
    const people = [{ name: this.name, guest: null as Guest | null }, ...this.guests.map((g) => ({ name: g.name, guest: g as Guest | null }))];
    const cpuNames = ['CPU 白鷺', 'CPU 烏', 'CPU 鷹'];
    while (people.length < count) people.push({ name: cpuNames[people.length - 1] ?? 'CPU', guest: null });
    const order = people.map((_, i) => i).sort(() => Math.random() - 0.5);
    const seats = order.map((i) => people[i]);
    const cpu = seats.map((p, i) => order[i] !== 0 && p.guest === null);
    const links = seats.map((p, i) => {
      if (order[i] === 0) {
        this.hostSeat = i;
        return { send: (v: GameView) => this.onView(v) };
      }
      if (p.guest) {
        p.guest.seat = i;
        const g = p.guest;
        return { send: (v: GameView) => this.sendTo(g.conn, { t: 'view', v }) };
      }
      return {};
    });
    this.host = new GameHost({ names: seats.map((p) => p.name), cpu, length }, links, { timed: true });
    this.host.start();
  }

  act(a: Action) {
    this.host?.action(this.hostSeat, a);
  }

  close() {
    for (const g of this.guests) this.sendTo(g.conn, { t: 'closed' });
    this.host?.stop();
    setTimeout(() => this.peer?.destroy(), 200);
  }
}

// ---------------------------------------------------------------- 参加者

export class RoomClient {
  peer!: Peer;
  conn: DataConnection | null = null;
  onLobby: (members: Member[]) => void = () => {};
  onView: (v: GameView) => void = () => {};
  onError: (msg: string) => void = () => {};
  onClosed: () => void = () => {};
  private closedByUser = false;
  private retries = 0;

  constructor(public name: string, public code: string) {}

  join(): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = new Peer(peerOptions());
      this.peer = peer;
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('接続がタイムアウトしました。コードを確認してください'));
        }
      }, 15000);
      peer.on('open', () => this.connect(() => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(); }
      }));
      peer.on('error', (e: Error & { type?: string }) => {
        const msg = e.type === 'peer-unavailable' ? 'ルームが見つかりません。コードを確認してください' : String(e.message ?? e);
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error(msg)); }
        else this.onError(msg);
      });
    });
  }

  private connect(onOpen: () => void) {
    const conn = this.peer.connect(PREFIX + this.code, { reliable: true });
    this.conn = conn;
    conn.on('open', () => {
      conn.send({ t: 'hello', name: this.name, token: myToken() } satisfies ClientMsg);
      onOpen();
    });
    conn.on('data', (raw) => {
      const msg = raw as HostMsg;
      if (msg.t === 'lobby') this.onLobby(msg.members);
      else if (msg.t === 'view') this.onView(msg.v);
      else if (msg.t === 'error') this.onError(msg.msg);
      else if (msg.t === 'closed') { this.closedByUser = true; this.onClosed(); }
    });
    conn.on('open', () => { this.retries = 0; });
    conn.on('close', () => {
      if (this.closedByUser) return;
      // 自動再接続（同じトークンで席に復帰）
      if (this.retries++ >= 10) { this.onClosed(); return; }
      setTimeout(() => {
        if (!this.peer.destroyed && !this.closedByUser) this.connect(() => {});
      }, 2000);
    });
  }

  act(a: Action) {
    if (this.conn?.open) this.conn.send({ t: 'act', a } satisfies ClientMsg);
  }

  close() {
    this.closedByUser = true;
    this.peer?.destroy();
  }
}
