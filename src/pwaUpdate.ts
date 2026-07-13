// PWA（アプリとしてインストールできる Web）の更新検知と適用（#15）。
//
// 背景: 以前は vite-plugin-pwa の registerType:'autoUpdate' を使っていたが、Android の
// WebAPK（ホーム画面から起動する PWA の実体）はプロセスを保持するため、デプロイ後に開き直しても
// Service Worker（バックグラウンドで動く常駐スクリプト。ページのキャッシュ配信を担う）が
// プリキャッシュした古い JS を配り続け、新バージョンへ切り替わったか分かりにくかった。
//
// ここでは registerType:'prompt' に切り替え、
//   (1) 新しい版が用意できたら画面に「更新があります・再読み込み」を出す（applyUpdate で適用）、
//   (2) フォアグラウンド復帰（タブに戻ってきた）ときに registration.update() を明示的に叩いて
//       更新チェックを促す、
// の2点で、実機でも確実に最新版へ更新できるようにする。

import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

// 新しい版が待機中か（＝更新を適用できる状態か）。
let needRefresh = false
// registerSW が返す「更新適用関数」。true を渡すと新SWを有効化しページを再読み込みする。
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

// React から「更新あり」状態を購読する。true になったらトーストを出す。
export function useNeedRefresh(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => needRefresh,
    () => false, // SSR は使わないが useSyncExternalStore の要求に合わせて既定値を返す
  )
}

// 「再読み込み」ボタンから呼ぶ。新SWを有効化してページをリロードし、最新版に切り替える。
export function applyUpdate(): void {
  void updateSW?.(true)
}

// 「×」ボタンから呼ぶ。今回は更新を適用せずトーストだけ閉じる（このセッション中は再表示しない）。
// 待機中の新SW自体は残るので、次にページを開いたとき（or 再読み込みボタンで）改めて適用できる。
// ※ 通常のブラウザ再読み込み(F5)では待機中SWは有効化されないため、確実に最新へ切り替えるには
//   「再読み込み」ボタン（applyUpdate）を使う必要がある。
export function dismissUpdate(): void {
  needRefresh = false
  emit()
}

// 起動時に1度だけ Service Worker を登録する（main.tsx から呼ぶ）。
// 開発サーバーでは SW を無効化しているため registerSW は実質何もしない安全なスタブになる。
let started = false
export function initPwaUpdate(): void {
  if (started) return
  started = true
  updateSW = registerSW({
    // 新しい版が待機に入ったら通知する。
    onNeedRefresh() {
      needRefresh = true
      emit()
    },
    // 登録完了時に registration を受け取り、フォアグラウンド復帰での更新チェックを仕込む。
    onRegisteredSW(_swScriptUrl, registration) {
      if (!registration) return
      document.addEventListener('visibilitychange', () => {
        // タブに戻ってきたタイミングでサーバーに新SWが無いか確認しに行く（#15）。
        if (document.visibilityState === 'visible') void registration.update()
      })
    },
  })
}
