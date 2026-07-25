// PWA（ホーム画面から起動できるアプリ版）の「インストール」導線。
//
// 背景（ユーザー報告・再発）: Android で「ホーム画面に追加」を選ぶと、ランチャー（アプリ一覧）に
// 出る本物のアプリ（WebAPK）ではなく、ただのショートカット（ブラウザで開くブックマーク）に
// なってしまうことがある。これは Chrome がその瞬間に「インストール可能」と判定できていないと、
// メニューの「ホーム画面に追加」がショートカット止まりになるため。
//
// 対策: ブラウザが「インストール可能」と判断したときにだけ発火する `beforeinstallprompt`
// イベントを保持しておき、アプリ内の「インストール」ボタンからその瞬間に `prompt()` を呼ぶ。
// これは Chrome 公式のインストールフローに直結するので、確実に WebAPK（＝ランチャーに並ぶ
// アプリ）としてインストールされる。イベントが来ない（＝ボタンが出ない）場合は、そもそも
// ブラウザがインストール可能と見なせていないサインになる（すでにインストール済み、または
// 古い Service Worker/マニフェストのキャッシュが残っている等）。

import { useSyncExternalStore } from 'react'

// `beforeinstallprompt` は仕様策定中で TS 標準の型に無いため、必要な形だけ最小限に定義する。
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// 保留しておいたインストールプロンプト（未取得なら null）。
let deferred: BeforeInstallPromptEvent | null = null
// すでにインストール済みか（appinstalled を受けたら true。ボタンを引っ込めるのに使う）。
let installed = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

// 起動時に1度だけ呼ぶ（main.tsx から）。インストール可能通知と完了通知を購読する。
let started = false
export function initPwaInstall(): void {
  if (started) return
  started = true
  // 診断ログ（Android 実機で `beforeinstallprompt` が発火するか、Chrome DevTools のリモート
  // インスペクト＝chrome://inspect のコンソールで確認するため）。standalone=true なら既に
  // インストール済みの状態で開いており、その場合ブラウザはインストールプロンプトを出さない。
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari 用（display-mode を返さないため navigator.standalone を併用）。
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  console.info('[PWA] initPwaInstall', { standalone })
  window.addEventListener('beforeinstallprompt', (e) => {
    // 既定の自動バナーを抑止し、こちらの好きなタイミング（ボタン押下時）に出せるようにする。
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    console.info('[PWA] beforeinstallprompt が発火（インストール可能）')
    emit()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    console.info('[PWA] appinstalled（インストール完了）')
    emit()
  })
}

// React から「インストールボタンを出せるか」を購読する。
// プロンプトを保持していて、かつまだ未インストールのときだけ true。
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => deferred !== null && !installed,
    () => false, // SSR は使わないが useSyncExternalStore の要求に合わせて既定値を返す
  )
}

// 「インストール」ボタンから呼ぶ。保持していたプロンプトを表示し、ユーザーの選択を待つ。
// プロンプトは一度きり（使うと再利用できない）なので、呼び終えたら破棄してボタンを消す。
export async function promptInstall(): Promise<void> {
  const d = deferred
  if (!d) return
  await d.prompt()
  await d.userChoice
  deferred = null
  emit()
}
