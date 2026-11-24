// サウンド管理
// - 発声ボイス: あみたろの声素材工房（https://amitaro.net/）の音声素材（public/voice/）
// - BGM / 効果音: 外部素材を使わず、このファイル内で WebAudio により合成しているオリジナル曲

export type VoiceKind = 'riichi' | 'pon' | 'chi' | 'kan' | 'ron' | 'tsumo';

const VOICE_FILES: Record<VoiceKind, string> = {
  riichi: 'riichi.wav', pon: 'pon.wav', chi: 'chii.wav', kan: 'kan.wav', ron: 'ron.wav', tsumo: 'tsumo.wav',
};

interface AudioSettings {
  bgm: boolean;
  voice: boolean;
  /** 音量（0〜1） */
  bgmVol: number;
  voiceVol: number;
  seVol: number;
}

const DEFAULT_AUDIO: AudioSettings = { bgm: true, voice: true, bgmVol: 0.6, voiceVol: 0.8, seVol: 0.7 };

function load(): AudioSettings {
  try {
    return { ...DEFAULT_AUDIO, ...JSON.parse(localStorage.getItem('tmj-audio') ?? '{}') };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// ---- BGM の譜面（Aマイナー・ペンタトニック。8分音符単位、0 は休符）----
const A4 = 69, C5 = 72, D5 = 74, E5 = 76, G5 = 79, A5 = 81, G4 = 67, E4 = 64;
const MELODY: number[][] = [
  // フレーズA
  [A4, 0, C5, D5, E5, 0, D5, C5], [A4, 0, G4, A4, C5, 0, 0, 0],
  [D5, 0, E5, G5, E5, 0, D5, C5], [D5, 0, 0, C5, A4, 0, 0, 0],
  // フレーズB
  [E5, 0, G5, A5, G5, 0, E5, D5], [C5, 0, D5, E5, D5, 0, 0, 0],
  [A4, C5, D5, 0, E5, D5, C5, A4], [G4, 0, A4, 0, A4, 0, 0, 0],
  // フレーズC（静かな間奏）
  [E4, 0, 0, A4, 0, 0, C5, 0], [D5, 0, 0, C5, 0, A4, 0, 0],
  [G4, 0, 0, A4, 0, 0, C5, 0], [A4, 0, 0, 0, E4, 0, 0, 0],
  // フレーズA'
  [A4, 0, C5, D5, E5, 0, G5, E5], [D5, 0, C5, D5, E5, 0, 0, 0],
  [G5, 0, E5, D5, C5, 0, D5, E5], [A4, 0, 0, 0, 0, 0, 0, 0],
];
// 小節ごとのベース音と分散和音
const BASS = [45, 41, 43, 45, 48, 43, 41, 45, 45, 41, 43, 45, 45, 41, 43, 45];
const CHORD: Record<number, number[]> = {
  45: [57, 60, 64], 41: [53, 57, 60], 43: [55, 59, 62], 48: [55, 60, 64],
};
const STEP = 0.36; // 8分音符の長さ（秒）

class AudioManager {
  settings = load();
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bgmGain!: GainNode;
  private buffers = new Map<VoiceKind, AudioBuffer>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private wantBgm = false;

  /** 最初のユーザー操作で呼ぶ（ブラウザの自動再生制限のため） */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.27 * this.settings.bgmVol;
    // 残響代わりの軽いディレイ
    const delay = this.ctx.createDelay(1);
    delay.delayTime.value = STEP * 1.5;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.28;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.35;
    this.bgmGain.connect(this.master);
    this.bgmGain.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(this.master);
    for (const [kind, file] of Object.entries(VOICE_FILES) as [VoiceKind, string][]) {
      fetch(`${import.meta.env.BASE_URL}voice/${file}`)
        .then((r) => r.arrayBuffer())
        .then((b) => this.ctx!.decodeAudioData(b))
        .then((buf) => this.buffers.set(kind, buf))
        .catch(() => { /* 音声が読めなくてもゲームは続行 */ });
    }
    if (this.wantBgm) this.startBgm();
  }

  save() {
    try { localStorage.setItem('tmj-audio', JSON.stringify(this.settings)); } catch { /* noop */ }
  }

  /** 音量の変更（0〜1） */
  setVolume(key: 'bgmVol' | 'voiceVol' | 'seVol', v: number) {
    this.settings[key] = Math.max(0, Math.min(1, v));
    this.save();
    if (key === 'bgmVol' && this.ctx) this.bgmGain.gain.value = 0.27 * this.settings.bgmVol;
    if (key === 'voiceVol') this.voice('pon');
    if (key === 'seVol') this.click();
  }

  toggle(key: 'bgm' | 'voice'): boolean {
    this.settings[key] = !this.settings[key];
    this.save();
    if (key === 'bgm') {
      if (this.settings.bgm && this.wantBgm) this.startBgm();
      else this.haltBgm();
    }
    return this.settings[key];
  }

  voice(kind: VoiceKind) {
    if (!this.ctx || !this.settings.voice) return;
    const buf = this.buffers.get(kind);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 1.25 * this.settings.voiceVol;
    src.connect(g).connect(this.master);
    src.start();
  }

  /** 打牌音（合成） */
  click() {
    const ctx = this.ctx;
    if (!ctx || !this.settings.voice) return;
    const t = ctx.currentTime;
    const len = 0.05;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0.7 * this.settings.seVol;
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.06);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.35 * this.settings.seVol, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  // ------------------------------------------------ BGM

  startBgm() {
    this.wantBgm = true;
    if (!this.ctx || !this.settings.bgm || this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 120);
  }

  stopBgm() {
    this.wantBgm = false;
    this.haltBgm();
  }

  private haltBgm() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule() {
    const ctx = this.ctx!;
    if (ctx.state !== 'running') return;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.4) {
      const bar = Math.floor(this.step / 8) % MELODY.length;
      const pos = this.step % 8;
      const t = this.nextTime;
      const note = MELODY[bar][pos];
      if (note) this.pluck(midi(note), t, 0.5, 1.6);
      const root = BASS[bar];
      if (pos === 0) this.bass(midi(root - 12 + 12), t, STEP * 7);
      // 分散和音（裏拍で静かに）
      if (pos % 2 === 1) {
        const ch = CHORD[root];
        this.pluck(midi(ch[((pos - 1) / 2) % ch.length]), t, 0.16, 0.9);
      }
      this.nextTime += STEP;
      this.step++;
    }
  }

  /** 琴のような撥弦音 */
  private pluck(freq: number, t: number, vol: number, dur: number) {
    const ctx = this.ctx!;
    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.003;
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + dur * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o1.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(g).connect(this.bgmGain);
    o1.start(t); o2.start(t);
    o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  private bass(freq: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.bgmGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

export const audio = new AudioManager();

if (typeof document !== 'undefined') {
  const unlock = () => audio.unlock();
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    // 画面を閉じている間は BGM を止める
    const ctx = (audio as unknown as { ctx: AudioContext | null }).ctx;
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
}
