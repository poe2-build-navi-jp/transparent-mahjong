/**
 * 課金（サブスク・買い切り）の窓口。
 *
 * アプリ版（Capacitor）では RevenueCat（@revenuecat/purchases-capacitor）経由で App Store / Google Play の課金を使う。
 * ブラウザ版では購入できない（ストア外のデジタル課金はアプリ内に置けないため）。
 *
 * - プレミアム（月額800円）: オンライン対戦が無制限・広告なし。entitlement ID "premium"
 * - 広告削除（買い切り）: 広告なし。entitlement ID "no_ads"
 * 価格はストア側（App Store Connect / Google Play Console）で設定し、表示はストアから取得した値を使う。
 *
 * RevenueCat の appUserID には、対戦サーバーで使う端末トークンを渡す。
 * サーバーは同じ ID で RevenueCat に問い合わせ、プレミアムかどうかを確かめる。
 */
import { myToken } from '../net/online';

export interface Entitlements {
  premium: boolean;
  noAds: boolean;
}

interface RcEntitlement { isActive: boolean }
interface RcCustomerInfo { entitlements: { active: Record<string, RcEntitlement> } }
interface RcPackage { identifier: string; product: { priceString: string } }
interface RcPurchases {
  configure(o: { apiKey: string; appUserID: string }): Promise<void>;
  getCustomerInfo(): Promise<{ customerInfo: RcCustomerInfo }>;
  getOfferings(): Promise<{ current: { availablePackages: RcPackage[] } | null; all?: Record<string, { availablePackages: RcPackage[] }> }>;
  purchasePackage(o: { aPackage: RcPackage }): Promise<{ customerInfo: RcCustomerInfo }>;
  restorePurchases(): Promise<{ customerInfo: RcCustomerInfo }>;
}

const PREMIUM_ENTITLEMENT = 'premium';
const NO_ADS_ENTITLEMENT = 'no_ads';
/** RevenueCat の Offering 内のパッケージ ID */
const PKG_PREMIUM = '$rc_monthly';
const PKG_NO_ADS = 'no_ads';

function plugin(): RcPurchases | null {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: { Purchases?: RcPurchases } } }).Capacitor;
  return cap?.isNativePlatform?.() ? cap.Plugins?.Purchases ?? null : null;
}

function platformKey(): string {
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  return cap?.getPlatform?.() === 'ios' ? import.meta.env.VITE_RC_IOS_KEY ?? '' : import.meta.env.VITE_RC_ANDROID_KEY ?? '';
}

let configured: Promise<boolean> | null = null;
let current: Entitlements = { premium: false, noAds: false };
const listeners = new Set<(e: Entitlements) => void>();

function apply(info: RcCustomerInfo) {
  const a = info.entitlements.active;
  current = { premium: !!a[PREMIUM_ENTITLEMENT]?.isActive, noAds: !!a[PREMIUM_ENTITLEMENT]?.isActive || !!a[NO_ADS_ENTITLEMENT]?.isActive };
  for (const l of listeners) l(current);
}

export const billing = {
  /** この環境で購入できるか（アプリ版のみ） */
  get available(): boolean {
    return plugin() !== null && platformKey() !== '';
  },

  get entitlements(): Entitlements {
    return current;
  },

  onChange(fn: (e: Entitlements) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** 起動時に呼ぶ */
  init(): Promise<boolean> {
    if (configured) return configured;
    configured = (async () => {
      const p = plugin();
      if (!p || !platformKey()) return false;
      try {
        await p.configure({ apiKey: platformKey(), appUserID: myToken() });
        apply((await p.getCustomerInfo()).customerInfo);
        return true;
      } catch {
        return false;
      }
    })();
    return configured;
  },

  /** ストアに登録した価格の表示用文字列 */
  async prices(): Promise<{ premium: string | null; noAds: string | null }> {
    const p = plugin();
    if (!p || !(await this.init())) return { premium: null, noAds: null };
    try {
      const off = await p.getOfferings();
      const pkgs = off.current?.availablePackages ?? [];
      return {
        premium: pkgs.find((x) => x.identifier === PKG_PREMIUM)?.product.priceString ?? null,
        noAds: pkgs.find((x) => x.identifier === PKG_NO_ADS)?.product.priceString ?? null,
      };
    } catch {
      return { premium: null, noAds: null };
    }
  },

  async buy(kind: 'premium' | 'noAds'): Promise<Entitlements> {
    const p = plugin();
    if (!p || !(await this.init())) throw new Error('購入はアプリ版でのみ利用できます');
    const off = await p.getOfferings();
    const id = kind === 'premium' ? PKG_PREMIUM : PKG_NO_ADS;
    const pkg = off.current?.availablePackages.find((x) => x.identifier === id);
    if (!pkg) throw new Error('商品情報を取得できませんでした。時間をおいてお試しください');
    apply((await p.purchasePackage({ aPackage: pkg })).customerInfo);
    return current;
  },

  async restore(): Promise<Entitlements> {
    const p = plugin();
    if (!p || !(await this.init())) throw new Error('購入の復元はアプリ版でのみ利用できます');
    apply((await p.restorePurchases()).customerInfo);
    return current;
  },
};
