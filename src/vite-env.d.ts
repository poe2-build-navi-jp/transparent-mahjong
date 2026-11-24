/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
  /** 'steam' = Steam 版（PC）としてビルド */
  readonly VITE_PLATFORM?: string;
  readonly VITE_PEER_HOST?: string;
  readonly VITE_PEER_PORT?: string;
  readonly VITE_PEER_PATH?: string;
  readonly VITE_PEER_SECURE?: string;
  /** RevenueCat の公開 SDK キー（アプリ版） */
  readonly VITE_RC_IOS_KEY?: string;
  readonly VITE_RC_ANDROID_KEY?: string;
  /** AdMob の全画面広告ユニット ID（アプリ版） */
  readonly VITE_ADMOB_INTERSTITIAL_IOS?: string;
  readonly VITE_ADMOB_INTERSTITIAL_ANDROID?: string;
}
