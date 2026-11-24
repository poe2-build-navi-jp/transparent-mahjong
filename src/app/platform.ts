/**
 * 実行環境ごとの違いをまとめる窓口。
 *
 * - ブラウザ / スマホアプリ（Capacitor）: 何もしない、またはブラウザの機能を使う
 * - PC版（Electron + Steam）: desktop/preload.cjs が window.tmjDesktop を用意する
 */

interface DesktopBridge {
  /** 全画面の切り替え */
  setFullscreen(on: boolean): Promise<void>;
  isFullscreen(): Promise<boolean>;
  quit(): void;
  steam?: {
    /** Steam クライアントにつながっているか */
    available(): Promise<boolean>;
    activateAchievement(id: string): Promise<void>;
    /** 対戦サーバーで本人確認するための認証チケット（16進文字列） */
    authTicket(): Promise<string | null>;
    /** Steam のプレイヤー名 */
    personaName(): Promise<string | null>;
    /** Steam の言語設定（japanese / english など） */
    language(): Promise<string | null>;
    cloudRead?(name: string): Promise<string | null>;
    cloudWrite?(name: string, content: string): Promise<boolean>;
  };
}

function bridge(): DesktopBridge | null {
  return (window as unknown as { tmjDesktop?: DesktopBridge }).tmjDesktop ?? null;
}

export const platform = {
  /** PC版（Electron）で動いているか */
  get isDesktop(): boolean {
    return bridge() !== null;
  },

  /** Steam 版として動いているか（Steam クライアント接続済み） */
  async steamAvailable(): Promise<boolean> {
    try { return (await bridge()?.steam?.available()) ?? false; } catch { return false; }
  },

  async setFullscreen(on: boolean): Promise<void> {
    const b = bridge();
    if (b) { await b.setFullscreen(on); return; }
    try {
      if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      if (!on && document.fullscreenElement) await document.exitFullscreen();
    } catch { /* 全画面にできない環境 */ }
  },

  async isFullscreen(): Promise<boolean> {
    const b = bridge();
    if (b) return b.isFullscreen();
    return !!document.fullscreenElement;
  },

  /** 全画面にできる環境か */
  get canFullscreen(): boolean {
    return bridge() !== null || !!document.documentElement.requestFullscreen;
  },

  quit() {
    bridge()?.quit();
  },

  unlockAchievement(id: string) {
    void bridge()?.steam?.activateAchievement(id).catch(() => {});
  },

  async steamAuthTicket(): Promise<string | null> {
    try { return (await bridge()?.steam?.authTicket()) ?? null; } catch { return null; }
  },

  async steamName(): Promise<string | null> {
    try { return (await bridge()?.steam?.personaName()) ?? null; } catch { return null; }
  },

  /** Steam クラウドから読む（PC版のみ） */
  async cloudRead(name: string): Promise<string | null> {
    try { return (await bridge()?.steam?.cloudRead?.(name)) ?? null; } catch { return null; }
  },

  cloudWrite(name: string, content: string) {
    void bridge()?.steam?.cloudWrite?.(name, content).catch(() => false);
  },

  async steamLanguage(): Promise<string | null> {
    try { return (await bridge()?.steam?.language()) ?? null; } catch { return null; }
  },
};

// F11 で全画面切り替え（PC・ブラウザ共通）
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F11') return;
    e.preventDefault();
    void platform.isFullscreen().then((on) => platform.setFullscreen(!on));
  });
}
