/**
 * 透明麻雀 オンライン対戦サーバー（Cloudflare Workers + Durable Objects）
 *
 * - 1ルーム = 1 Durable Object。ゲームの進行（権威）はすべてサーバーで行う
 * - 各プレイヤーには「その人に見えてよい情報」だけを送る（他家の不透明牌は送らない）
 * - 通信が切れた席は CPU が代打ちし、同じトークンで再接続すると席に戻れる
 * - ホスト（ルームを作った人）が抜けても対局は続く
 */
import type { Action, GameView } from '../../src/engine/game';
import { GameHost } from '../../src/net/host';
import { sanitizeName } from '../../src/net/names';
import { DEFAULT_RULES, sanitizeRules, type Rules } from '../../src/engine/rules';

export interface Env {
  ROOMS: DurableObjectNamespace;
  /** 接続を許可するオリジン（カンマ区切り）。未設定なら全て許可 */
  ALLOWED_ORIGINS?: string;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CPU_NAMES = ['CPU 白鷺', 'CPU 烏', 'CPU 鷹'];
/** 誰もいなくなったルームを片付けるまでの時間 */
const EMPTY_ROOM_TTL = 10 * 60 * 1000;

function makeCode(): string {
  const r = new Uint32Array(6);
  crypto.getRandomValues(r);
  return Array.from(r, (v) => CODE_CHARS[v % CODE_CHARS.length]).join('');
}

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.length === 0 || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin || '*' : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function originAllowed(req: Request, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  const origin = req.headers.get('Origin');
  // アプリ（Capacitor）からの接続は Origin が capacitor://localhost 等になるので ALLOWED_ORIGINS に含めること
  return origin !== null && allowed.includes(origin);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const headers = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { headers });

    if (url.pathname === '/api/health') return Response.json({ ok: true }, { headers });

    // ルーム作成: 空いているコードを確保して返す
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      if (!originAllowed(req, env)) return new Response('forbidden', { status: 403, headers });
      for (let i = 0; i < 8; i++) {
        const code = makeCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch(`https://room/reserve?code=${code}`, { method: 'POST' });
        if (res.ok) return Response.json({ code }, { headers });
      }
      return new Response('busy', { status: 503, headers });
    }

    // 接続: /api/rooms/:code/ws
    const m = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{4,8})\/ws$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      if (!originAllowed(req, env)) return new Response('forbidden', { status: 403 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
      return stub.fetch(req);
    }
    return new Response('not found', { status: 404, headers });
  },
};

// ---------------------------------------------------------------- ルーム

type ClientMsg =
  | { t: 'hello'; name: string; token: string }
  | { t: 'start'; rules?: Rules; length?: 'tonpu' | 'hanchan'; count?: 3 | 4 }
  | { t: 'rules'; rules: Rules }
  | { t: 'act'; a: Action }
  | { t: 'ping' };

interface Member {
  token: string;
  name: string;
  ws: WebSocket | null;
  seat: number;
  joinedAt: number;
}

export class Room implements DurableObject {
  private code = '';
  private reserved = false;
  private members: Member[] = [];
  private host: GameHost | null = null;
  private hostToken = '';
  private rules: Rules = { ...DEFAULT_RULES };
  private finished = false;

  constructor(private state: DurableObjectState, _env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/reserve') {
      if (this.reserved) return new Response('taken', { status: 409 });
      if (await this.state.storage.get('code')) return new Response('taken', { status: 409 });
      this.reserved = true;
      this.code = url.searchParams.get('code') ?? '';
      await this.state.storage.put('code', this.code);
      await this.state.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL);
      return new Response('ok');
    }
    if (!this.reserved) {
      // メモリから追い出された後でも、確保済みのコードなら受け付ける
      const saved = await this.state.storage.get<string>('code');
      if (saved) { this.reserved = true; this.code = saved; }
    }
    if (!this.reserved) {
      // 存在しないコード
      const pair = new WebSocketPair();
      pair[1].accept();
      pair[1].send(JSON.stringify({ t: 'error', msg: 'ルームが見つかりません。コードを確認してください', fatal: true }));
      pair[1].close(4004, 'not found');
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    const pair = new WebSocketPair();
    const ws = pair[1];
    ws.accept();
    this.attach(ws);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private send(ws: WebSocket | null, msg: unknown) {
    if (!ws) return;
    try { ws.send(JSON.stringify(msg)); } catch { /* 切断済み */ }
  }

  private lobby() {
    const list = this.members.map((m) => ({ name: m.name, host: m.token === this.hostToken, online: m.ws !== null }));
    for (const m of this.members) {
      this.send(m.ws, { t: 'lobby', code: this.code, members: list, youAreHost: m.token === this.hostToken, rules: this.rules });
    }
  }

  private attach(ws: WebSocket) {
    let me: Member | null = null;
    ws.addEventListener('message', (ev) => {
      let msg: ClientMsg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.t === 'ping') { this.send(ws, { t: 'pong' }); return; }
      if (msg.t === 'hello') {
        const token = String(msg.token ?? '').slice(0, 64);
        if (!token) return;
        const name = sanitizeName(msg.name, 'ゲスト');
        const existing = this.members.find((m) => m.token === token);
        if (existing) {
          // 再接続
          try { existing.ws?.close(4000, 'replaced'); } catch { /* noop */ }
          existing.ws = ws;
          me = existing;
          if (this.host && existing.seat >= 0) {
            const seat = existing.seat;
            this.host.setLink(seat, { send: (v: GameView) => this.send(existing.ws, { t: 'view', v }) });
          } else {
            existing.name = name;
            this.lobby();
          }
          return;
        }
        if (this.host || this.finished) {
          this.send(ws, { t: 'error', msg: 'この対局はすでに開始しています', fatal: true });
          ws.close(4003, 'started');
          return;
        }
        if (this.members.length >= 4) {
          this.send(ws, { t: 'error', msg: 'ルームが満員です', fatal: true });
          ws.close(4003, 'full');
          return;
        }
        me = { token, name, ws, seat: -1, joinedAt: Date.now() };
        this.members.push(me);
        if (!this.hostToken) this.hostToken = token;
        this.lobby();
        return;
      }
      if (!me) return;
      if (msg.t === 'rules') {
        if (me.token !== this.hostToken || this.host) return;
        this.rules = sanitizeRules(msg.rules);
        this.lobby();
        return;
      }
      if (msg.t === 'start') {
        if (me.token !== this.hostToken || this.host) return;
        this.rules = sanitizeRules(msg.rules ?? { ...this.rules, length: msg.length, count: msg.count });
        const count = this.rules.count;
        if (this.members.length > count) {
          this.send(ws, { t: 'error', msg: `${count === 3 ? '三人' : '四人'}麻雀は${count}人までです` });
          this.lobby();
          return;
        }
        this.startGame();
        return;
      }
      if (msg.t === 'act' && this.host && me.seat >= 0) {
        this.host.action(me.seat, msg.a);
        if (this.host.game.phase === 'gameEnd') this.finished = true;
      }
    });
    const onClose = () => {
      if (!me || me.ws !== ws) return;
      me.ws = null;
      if (this.host) {
        if (me.seat >= 0) this.host.disconnect(me.seat);
      } else {
        // ロビーで抜けた人は外す。ホストが抜けたら次の人がホスト
        this.members = this.members.filter((m) => m !== me);
        if (me.token === this.hostToken) this.hostToken = this.members[0]?.token ?? '';
        this.lobby();
      }
      this.scheduleCleanup();
    };
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onClose);
  }

  private startGame() {
    const { count, length } = this.rules;
    const people: (Member | null)[] = [...this.members];
    while (people.length < count) people.push(null);
    // 席順はランダム
    for (let i = people.length - 1; i > 0; i--) {
      const r = new Uint32Array(1);
      crypto.getRandomValues(r);
      const j = r[0] % (i + 1);
      [people[i], people[j]] = [people[j], people[i]];
    }
    let ci = 0;
    const names = people.map((p) => (p ? p.name : CPU_NAMES[ci++]));
    const links = people.map((p, seat) => {
      if (!p) return {};
      p.seat = seat;
      return { send: (v: GameView) => this.send(p.ws, { t: 'view', v }) };
    });
    this.host = new GameHost({ names, cpu: people.map((p) => p === null), length, rules: this.rules }, links, { timed: true });
    this.host.start();
    // 開始時点で切断していた人の席はCPUに
    for (const p of people) if (p && !p.ws) this.host.disconnect(p.seat);
  }

  private scheduleCleanup() {
    if (this.members.some((m) => m.ws)) return;
    void this.state.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL);
  }

  async alarm() {
    // 一定時間だれも接続していなければルームを破棄
    if (this.members.some((m) => m.ws)) {
      await this.state.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL);
      return;
    }
    this.host?.stop();
    this.host = null;
    this.members = [];
    this.reserved = false;
    this.finished = false;
    this.hostToken = '';
    this.rules = { ...DEFAULT_RULES };
    await this.state.storage.deleteAll();
  }
}
