/**
 * 透明麻雀 オンライン対戦サーバー（Cloudflare Workers + Durable Objects）
 *
 * - 1ルーム = 1 Durable Object。ゲームの進行（権威）はすべてサーバーで行う
 * - 各プレイヤーには「その人に見えてよい情報」だけを送る（他家の不透明牌は送らない）
 * - 通信が切れた席は CPU が代打ちし、同じトークンで再接続すると席に戻れる
 * - ホスト（ルームを作った人）が抜けても対局は続く
 *
 * サーバー代の節約:
 * - WebSocket Hibernation API を使い、だれも操作していない間は Durable Object を休止させる
 * - CPU の手番や時間切れは setTimeout ではなくアラームで起こす（状態はストレージに保存）
 * - 人間が全員切断している間は対局を止める
 * - ルーム作成数に上限（1分あたり・接続元ごと）
 *
 * 無料枠: 1日あたりのオンライン対局数（FREE_GAMES_PER_DAY）。プレミアム会員は無制限。
 * 購入できるようになる（REVENUECAT_API_KEY を登録する）までは無料枠を適用しない。
 */
import type { Action, GameView } from '../../src/engine/game';
import { DEFAULT_RULES, sanitizeRules, type Rules } from '../../src/engine/rules';
import { GameHost, type HostSnapshot } from '../../src/net/host';
import { sanitizeName } from '../../src/net/names';

export interface Env {
  ROOMS: DurableObjectNamespace;
  QUOTA: DurableObjectNamespace;
  /** 接続を許可するオリジン（カンマ区切り）。未設定なら全て許可 */
  ALLOWED_ORIGINS?: string;
  /** 1日あたりの無料オンライン対局数。"0" で制限なし */
  FREE_GAMES_PER_DAY?: string;
  /** 1つの接続元が1分間に作れるルーム数 */
  ROOMS_PER_MINUTE?: string;
  /** RevenueCat のシークレット API キー（wrangler secret で設定）。未設定ならプレミアム判定なし */
  REVENUECAT_API_KEY?: string;
  /** プレミアムの entitlement ID（RevenueCat で作ったもの） */
  PREMIUM_ENTITLEMENT?: string;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CPU_NAMES = ['CPU 白鷺', 'CPU 烏', 'CPU 鷹'];
/** 誰もいなくなったルームを片付けるまでの時間 */
const EMPTY_ROOM_TTL = 10 * 60 * 1000;
/** ルームの最長寿命（放置対策） */
const ROOM_MAX_AGE = 6 * 60 * 60 * 1000;

function makeCode(): string {
  const r = new Uint32Array(6);
  crypto.getRandomValues(r);
  return Array.from(r, (v) => CODE_CHARS[v % CODE_CHARS.length]).join('');
}

function allowedList(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = allowedList(env);
  const ok = allowed.length === 0 || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin || '*' : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function originAllowed(req: Request, env: Env): boolean {
  const allowed = allowedList(env);
  if (allowed.length === 0) return true;
  const origin = req.headers.get('Origin');
  // 同じ場所から配信した画面（Origin が自分自身）も許可
  if (origin && origin === new URL(req.url).origin) return true;
  // アプリ（Capacitor）からの接続は Origin が capacitor://localhost 等になるので ALLOWED_ORIGINS に含めること
  return origin !== null && allowed.includes(origin);
}

function quotaStub(env: Env) {
  return env.QUOTA.get(env.QUOTA.idFromName('quota-v1'));
}

const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return new Response('not found', { status: 404 });
    const headers = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { headers });

    if (url.pathname === '/api/health') return Response.json({ ok: true, version: 2 }, { headers });

    // 本日の残り無料対局・プレミアム状態
    if (url.pathname === '/api/quota' && req.method === 'GET') {
      const token = url.searchParams.get('token') ?? '';
      if (!TOKEN_RE.test(token)) return Response.json({ error: 'bad token' }, { status: 400, headers });
      const res = await quotaStub(env).fetch('https://quota/status', { method: 'POST', body: JSON.stringify({ tokens: [token] }) });
      const data = (await res.json()) as { status: QuotaStatus[] };
      return Response.json(data.status[0], { headers });
    }

    // ルーム作成: 空いているコードを確保して返す
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      if (!originAllowed(req, env)) return new Response('forbidden', { status: 403, headers });
      // 乱用対策: 接続元ごとの作成回数
      const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
      const rl = await quotaStub(env).fetch('https://quota/ratelimit', { method: 'POST', body: JSON.stringify({ key: ip }) });
      if (!rl.ok) return Response.json({ error: 'ルームの作成が多すぎます。少し時間をおいてください' }, { status: 429, headers });
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
  seat: number;
}

interface RoomData {
  code: string;
  createdAt: number;
  hostToken: string;
  rules: Rules;
  members: Member[];
  host: HostSnapshot | null;
  finished: boolean;
  /** 最後に誰かが接続していた時刻 */
  lastSeen: number;
}

interface Attachment {
  token: string;
}

export class Room implements DurableObject {
  private data: RoomData | null = null;
  private host: GameHost | null = null;
  /** ゲームが次に起きる予定時刻 */
  private nextGameAt: number | null = null;
  private starting = false;

  constructor(private state: DurableObjectState, private env: Env) {}

  // ------------------------------------------------ 保存・復元

  private async load(): Promise<RoomData | null> {
    if (!this.data) this.data = (await this.state.storage.get<RoomData>('room')) ?? null;
    if (this.data?.host && !this.host) {
      this.host = GameHost.restore(this.data.host, this.links(), this.hostOpts());
      // 休止前に予約していた時刻を引き継ぐ
      const d = (this.data.host as HostSnapshot).due;
      this.nextGameAt = d.length ? Math.min(...d.map((x) => x.at)) : null;
      this.host.setRunning(this.anyHumanOnline());
    }
    return this.data;
  }

  private async save() {
    if (!this.data) return;
    if (this.host) this.data.host = this.host.snapshot();
    await this.state.storage.put('room', this.data);
    await this.syncAlarm();
  }

  private hostOpts() {
    return { timed: true, schedule: (at: number | null) => { this.nextGameAt = at; } };
  }

  /** 次のアラーム = ゲームの予定と、片付けの予定の早いほう */
  private async syncAlarm() {
    const d = this.data;
    if (!d) return;
    const online = this.sockets().length > 0;
    const cleanupAt = Math.min(online ? Date.now() + EMPTY_ROOM_TTL : d.lastSeen + EMPTY_ROOM_TTL, d.createdAt + ROOM_MAX_AGE);
    const next = this.nextGameAt !== null && online ? Math.min(this.nextGameAt, cleanupAt) : cleanupAt;
    await this.state.storage.setAlarm(Math.max(Date.now() + 50, next));
  }

  // ------------------------------------------------ 接続

  private sockets(token?: string): WebSocket[] {
    return this.state.getWebSockets().filter((ws) => {
      const a = ws.deserializeAttachment() as Attachment | null;
      return a && (token === undefined || a.token === token);
    });
  }

  private send(ws: WebSocket, msg: unknown) {
    try { ws.send(JSON.stringify(msg)); } catch { /* 切断済み */ }
  }

  private sendToken(token: string, msg: unknown) {
    for (const ws of this.sockets(token)) this.send(ws, msg);
  }

  private links() {
    const d = this.data!;
    const seats = this.host?.game.n ?? d.rules.count;
    return Array.from({ length: seats }, (_, s) => {
      const m = d.members.find((x) => x.seat === s);
      return m ? { send: (v: GameView) => this.sendToken(m.token, { t: 'view', v }) } : {};
    });
  }

  private anyHumanOnline(): boolean {
    return this.data!.members.some((m) => this.sockets(m.token).length > 0);
  }

  private lobby() {
    const d = this.data!;
    const list = d.members.map((m) => ({ name: m.name, host: m.token === d.hostToken, online: this.sockets(m.token).length > 0 }));
    for (const m of d.members) {
      this.sendToken(m.token, { t: 'lobby', code: d.code, members: list, youAreHost: m.token === d.hostToken, rules: d.rules });
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/reserve') {
      if (await this.load()) return new Response('taken', { status: 409 });
      const now = Date.now();
      this.data = {
        code: url.searchParams.get('code') ?? '', createdAt: now, hostToken: '', rules: { ...DEFAULT_RULES },
        members: [], host: null, finished: false, lastSeen: now,
      };
      await this.save();
      return new Response('ok');
    }
    const d = await this.load();
    const pair = new WebSocketPair();
    if (!d) {
      // 存在しないコード
      pair[1].accept();
      pair[1].send(JSON.stringify({ t: 'error', msg: 'ルームが見つかりません。コードを確認してください', fatal: true }));
      pair[1].close(4004, 'not found');
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    // 休止できる WebSocket として受け付ける
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const d = await this.load();
    if (!d) { ws.close(4004, 'gone'); return; }
    let msg: ClientMsg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
    if (msg.t === 'ping') { this.send(ws, { t: 'pong' }); return; }
    d.lastSeen = Date.now();
    const att = ws.deserializeAttachment() as Attachment | null;

    if (msg.t === 'hello') {
      const token = String(msg.token ?? '');
      if (!TOKEN_RE.test(token)) { this.send(ws, { t: 'error', msg: '接続情報が正しくありません', fatal: true }); ws.close(4000, 'bad token'); return; }
      const name = sanitizeName(msg.name, 'ゲスト');
      // 同じ端末の古い接続は閉じる
      for (const old of this.sockets(token)) if (old !== ws) { try { old.close(4000, 'replaced'); } catch { /* noop */ } }
      const existing = d.members.find((m) => m.token === token);
      if (existing) {
        ws.serializeAttachment({ token } satisfies Attachment);
        if (this.host && existing.seat >= 0) {
          this.host.setLink(existing.seat, { send: (v: GameView) => this.sendToken(token, { t: 'view', v }) });
          this.host.setRunning(true);
        } else {
          existing.name = name;
          this.lobby();
        }
        await this.save();
        return;
      }
      if (this.host || d.finished) {
        this.send(ws, { t: 'error', msg: 'この対局はすでに開始しています', fatal: true });
        ws.close(4003, 'started');
        return;
      }
      if (d.members.length >= 4) {
        this.send(ws, { t: 'error', msg: 'ルームが満員です', fatal: true });
        ws.close(4003, 'full');
        return;
      }
      ws.serializeAttachment({ token } satisfies Attachment);
      d.members.push({ token, name, seat: -1 });
      if (!d.hostToken) d.hostToken = token;
      this.lobby();
      await this.save();
      return;
    }

    if (!att) return;
    const me = d.members.find((m) => m.token === att.token);
    if (!me) return;

    if (msg.t === 'rules') {
      if (me.token !== d.hostToken || this.host) return;
      d.rules = sanitizeRules(msg.rules);
      this.lobby();
      await this.save();
      return;
    }
    if (msg.t === 'start') {
      if (me.token !== d.hostToken || this.host || this.starting) return;
      d.rules = sanitizeRules(msg.rules ?? { ...d.rules, length: msg.length, count: msg.count });
      const count = d.rules.count;
      if (d.members.length > count) {
        this.send(ws, { t: 'error', msg: `${count === 3 ? '三人' : '四人'}麻雀は${count}人までです` });
        this.lobby();
        return;
      }
      // 無料枠の確認と消費（全員分を一度に）。問い合わせ中に二重で開始されないようにする
      this.starting = true;
      let q: { ok: boolean; blocked: string[] };
      try {
        const res = await quotaStub(this.env).fetch('https://quota/use', {
          method: 'POST', body: JSON.stringify({ tokens: d.members.map((m) => m.token) }),
        });
        q = (await res.json()) as { ok: boolean; blocked: string[] };
      } finally {
        this.starting = false;
      }
      if (this.host) return;
      if (!q.ok) {
        const names = d.members.filter((m) => q.blocked.includes(m.token)).map((m) => m.name);
        for (const m of d.members) {
          if (q.blocked.includes(m.token)) {
            this.sendToken(m.token, { t: 'error', msg: '本日の無料オンライン対局を使い切りました。プレミアム会員なら無制限で遊べます', code: 'quota' });
          } else if (m.token === d.hostToken) {
            this.sendToken(m.token, { t: 'error', msg: `${names.join('・')}さんは本日の無料オンライン対局を使い切っています`, code: 'quota-other' });
          }
        }
        return;
      }
      this.startGame();
      await this.save();
      return;
    }
    if (msg.t === 'act' && this.host && me.seat >= 0) {
      this.host.action(me.seat, msg.a);
      if (this.host.game.phase === 'gameEnd') d.finished = true;
      await this.save();
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.onGone(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.onGone(ws);
  }

  private async onGone(ws: WebSocket) {
    const d = await this.load();
    if (!d) return;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    // 同じ端末の別の接続がまだあれば何もしない
    if (this.sockets(att.token).some((x) => x !== ws)) return;
    const me = d.members.find((m) => m.token === att.token);
    if (!me) return;
    d.lastSeen = Date.now();
    if (this.host) {
      if (me.seat >= 0) this.host.disconnect(me.seat);
      // 人間が全員いなくなったら対局を止める（CPUだけで進めない）
      const others = d.members.some((m) => m !== me && this.sockets(m.token).some((x) => x !== ws));
      if (!others) this.host.setRunning(false);
    } else {
      // ロビーで抜けた人は外す。ホストが抜けたら次の人がホスト
      d.members = d.members.filter((m) => m !== me);
      if (me.token === d.hostToken) d.hostToken = d.members[0]?.token ?? '';
      this.lobby();
    }
    await this.save();
  }

  private startGame() {
    const d = this.data!;
    const { count, length } = d.rules;
    const people: (Member | null)[] = [...d.members];
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
    people.forEach((p, seat) => { if (p) p.seat = seat; });
    this.host = new GameHost({ names, cpu: people.map((p) => p === null), length, rules: d.rules }, [], this.hostOpts());
    for (let s = 0; s < count; s++) this.host.relink(s, this.links()[s]);
    this.host.start();
    // 開始時点で切断していた人の席はCPUに
    for (const p of people) if (p && this.sockets(p.token).length === 0) this.host.disconnect(p.seat);
  }

  async alarm() {
    const d = await this.load();
    if (!d) return;
    const now = Date.now();
    const online = this.sockets().length > 0;
    // 放置されたルームを破棄
    if ((!online && now - d.lastSeen >= EMPTY_ROOM_TTL) || now - d.createdAt >= ROOM_MAX_AGE) {
      for (const ws of this.state.getWebSockets()) { try { ws.close(4001, 'expired'); } catch { /* noop */ } }
      this.host?.stop();
      this.host = null;
      this.data = null;
      await this.state.storage.deleteAll();
      return;
    }
    if (this.host && online) {
      this.host.runDue(now);
      if (this.host.game.phase === 'gameEnd') d.finished = true;
    }
    await this.save();
  }
}

// ---------------------------------------------------------------- 無料枠・プレミアム

interface QuotaStatus {
  premium: boolean;
  used: number;
  /** 0 = 無制限 */
  limit: number;
  /** アプリ公開後の上限（今は制限していなくても表示用に返す） */
  plannedLimit: number;
  remaining: number | null;
}

/** 日本時間の日付 */
function todayJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export class Quota implements DurableObject {
  constructor(private state: DurableObjectState, private env: Env) {}

  /** アプリ公開後の1日あたりの無料対局数 */
  private get plannedLimit(): number {
    const n = Number(this.env.FREE_GAMES_PER_DAY ?? '1');
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
  }

  /**
   * 今の上限（0 = 無制限）。
   * 購入できる状態（RevenueCat のキーが登録済み）になるまでは制限しない。
   * アプリ公開時にキーを登録すると、その時点から自動で制限が始まる。
   */
  private get limit(): number {
    return this.env.REVENUECAT_API_KEY ? this.plannedLimit : 0;
  }

  /** RevenueCat でプレミアム（サブスク有効）か確認。結果は10分キャッシュ */
  private async isPremium(token: string): Promise<boolean> {
    const key = this.env.REVENUECAT_API_KEY;
    if (!key) return false;
    const cached = await this.state.storage.get<{ v: boolean; at: number }>(`p:${token}`);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.v;
    let v = false;
    try {
      const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(token)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { subscriber?: { entitlements?: Record<string, { expires_date: string | null }> } };
        const ent = body.subscriber?.entitlements?.[this.env.PREMIUM_ENTITLEMENT || 'premium'];
        v = !!ent && (ent.expires_date === null || Date.parse(ent.expires_date) > Date.now());
      } else if (cached) {
        v = cached.v; // 一時的なエラーなら前回の結果を使う
      }
    } catch {
      if (cached) v = cached.v;
    }
    await this.state.storage.put(`p:${token}`, { v, at: Date.now() });
    return v;
  }

  /** 日付が変わったら前日までの使用数を消す */
  private async rollover(today: string) {
    const day = await this.state.storage.get<string>('day');
    if (day === today) return;
    const old = await this.state.storage.list({ prefix: 'u:' });
    const keys = [...old.keys()];
    for (let i = 0; i < keys.length; i += 128) await this.state.storage.delete(keys.slice(i, i + 128));
    await this.state.storage.put('day', today);
  }

  private async status(token: string): Promise<QuotaStatus> {
    const premium = await this.isPremium(token);
    const used = (await this.state.storage.get<number>(`u:${token}`)) ?? 0;
    const limit = this.limit;
    return { premium, used, limit, plannedLimit: this.plannedLimit, remaining: premium || limit === 0 ? null : Math.max(0, limit - used) };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    await this.rollover(todayJst());

    if (url.pathname === '/ratelimit') {
      const { key } = (await req.json()) as { key: string };
      const max = Number(this.env.ROOMS_PER_MINUTE ?? '5') || 5;
      const minute = Math.floor(Date.now() / 60000);
      const k = `r:${minute}:${key}`;
      const n = ((await this.state.storage.get<number>(k)) ?? 0) + 1;
      await this.state.storage.put(k, n);
      // 古い記録の片付け
      if (n === 1) {
        const olds = await this.state.storage.list({ prefix: `r:${minute - 2}:`, limit: 128 });
        if (olds.size) await this.state.storage.delete([...olds.keys()]);
      }
      return new Response(null, { status: n > max ? 429 : 200 });
    }

    const { tokens } = (await req.json()) as { tokens: string[] };
    const list = (tokens ?? []).filter((t) => TOKEN_RE.test(t)).slice(0, 4);

    if (url.pathname === '/status') {
      return Response.json({ status: await Promise.all(list.map((t) => this.status(t))) });
    }

    if (url.pathname === '/use') {
      const st = await Promise.all(list.map((t) => this.status(t)));
      const blocked = list.filter((_, i) => st[i].remaining === 0);
      if (blocked.length) return Response.json({ ok: false, blocked });
      for (let i = 0; i < list.length; i++) {
        if (st[i].remaining !== null) await this.state.storage.put(`u:${list[i]}`, st[i].used + 1);
      }
      return Response.json({ ok: true, blocked: [] });
    }
    return new Response('not found', { status: 404 });
  }
}
