import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// ビルド時のコミットハッシュを取得する。git が無い環境や失敗時は 'unknown' にフォールバック。
function gitCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  // GitHub Pages はサブパス配信のため base の指定が必須。
  // 前後スラッシュ・大文字小文字までリポジトリ名と完全一致させること（間違えると全アセット404）。
  base: '/ABOperations/',
  plugins: [
    react(),
    // PWA（Service Worker + マニフェスト）。Android で「アプリをインストール」判定を
    // 満たすには Service Worker が事実上必要なため導入する。
    // オフライン対応は最小限（アプリシェルのプリキャッシュのみ）。Google API はキャッシュしない。
    VitePWA({
      // 新しいSWが用意できても即座に自動置換せず、ユーザーに「更新があります・再読み込み」を
      // 促してから適用する（#15）。autoUpdate は Android の WebAPK でプロセスが保持されると
      // 古いキャッシュのまま動き続けることがあり、新バージョンへ切り替わったか分かりにくかった。
      // prompt にして明示リロード＋フォアグラウンド復帰時の更新チェック（src/pwaUpdate.ts）を組む。
      registerType: 'prompt',
      // SW登録は自前で行う（src/pwaUpdate.ts の registerSW）。自動注入は無効化して二重登録を防ぐ。
      injectRegister: null,
      // マニフェストに含めない静的アセットもプリキャッシュ対象に加える
      includeAssets: ['apple-touch-icon.png'],
      // start_url / scope は Vite の base(/ABOperations/) からプラグインが自動設定する
      manifest: {
        id: '/ABOperations/',
        name: 'AB Operations',
        short_name: 'AB Operations',
        description: 'Google カレンダー・タスク・メールを1画面に集約した自分専用ダッシュボード',
        theme_color: '#f7f1e8',
        background_color: '#f7f1e8',
        display: 'standalone',
        orientation: 'portrait-primary',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // アプリシェル（ビルド成果物）だけをプリキャッシュする。
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // 未知のパスへの遷移時は index.html を返す（単一画面SPAのため）
        navigateFallback: 'index.html',
        // Google API/GISスクリプトは別オリジンなのでSWは触らない（常にネットワーク直行）
        runtimeCaching: [],
      },
      devOptions: {
        // 開発サーバーでは SW を無効化（デバッグ時の混乱を避ける）
        enabled: false,
      },
    }),
  ],
  define: {
    // ビルド情報を画面に表示するためのコンパイル時定数。
    // JSON.stringify で囲むことで「文字列リテラル」として埋め込まれる。
    __COMMIT_HASH__: JSON.stringify(gitCommitHash()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
