/**
 * 広告（アプリ版のみ）。半荘・東風戦が終わってタイトルへ戻るときに1回だけ全画面広告を出す。
 * プレミアム会員と広告削除の購入者には出さない。ブラウザ版では何もしない。
 *
 * アプリ版では @capacitor-community/admob を使う。広告ユニット ID はビルド時の環境変数で渡す:
 *   VITE_ADMOB_INTERSTITIAL_IOS / VITE_ADMOB_INTERSTITIAL_ANDROID
 */
import { billing } from './billing';

interface AdMobPlugin {
  initialize(o?: Record<string, unknown>): Promise<void>;
  prepareInterstitial(o: { adId: string }): Promise<void>;
  showInterstitial(): Promise<void>;
}

function plugin(): { ad: AdMobPlugin; platform: string } | null {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: { AdMob?: AdMobPlugin } } }).Capacitor;
  const ad = cap?.isNativePlatform?.() ? cap.Plugins?.AdMob : undefined;
  return ad ? { ad, platform: cap!.getPlatform?.() ?? '' } : null;
}

let ready: Promise<boolean> | null = null;

export const ads = {
  init(): Promise<boolean> {
    if (ready) return ready;
    ready = (async () => {
      const p = plugin();
      if (!p) return false;
      try { await p.ad.initialize(); return true; } catch { return false; }
    })();
    return ready;
  },

  /** 対局終了後の全画面広告。失敗しても遊びは止めない */
  async afterGame(): Promise<void> {
    if (billing.entitlements.noAds) return;
    const p = plugin();
    if (!p || !(await this.init())) return;
    const adId = p.platform === 'ios' ? import.meta.env.VITE_ADMOB_INTERSTITIAL_IOS : import.meta.env.VITE_ADMOB_INTERSTITIAL_ANDROID;
    if (!adId) return;
    try {
      await p.ad.prepareInterstitial({ adId });
      await p.ad.showInterstitial();
    } catch { /* 広告の在庫なしなど */ }
  },
};
