// 振動（触覚フィードバック）。アプリ（Capacitor）ではネイティブの Haptics、ブラウザでは Vibration API を使う
type CapHaptics = { impact(o: { style: string }): Promise<void> };

function load(): boolean {
  try { return localStorage.getItem('tmj-vibe') !== '0'; } catch { return true; }
}

export const haptics = {
  enabled: load(),
  toggle(): boolean {
    this.enabled = !this.enabled;
    try { localStorage.setItem('tmj-vibe', this.enabled ? '1' : '0'); } catch { /* noop */ }
    return this.enabled;
  },
  /** light: 打牌 / medium: 鳴き / heavy: 和了 */
  tap(strength: 'light' | 'medium' | 'heavy' = 'light') {
    if (!this.enabled) return;
    const cap = (window as unknown as { Capacitor?: { Plugins?: { Haptics?: CapHaptics } } }).Capacitor?.Plugins?.Haptics;
    if (cap) {
      void cap.impact({ style: strength.toUpperCase() }).catch(() => {});
      return;
    }
    try { navigator.vibrate?.(strength === 'light' ? 8 : strength === 'medium' ? 20 : [30, 40, 60]); } catch { /* 非対応 */ }
  },
};
