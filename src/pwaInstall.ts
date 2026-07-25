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
// これまでに一度でも `beforeinstallprompt` を受け取ったか（診断表示用。deferred は prompt() で
// 消費すると null に戻るため、「そもそも発火したか」を別に残しておく）。
let everPrompted = false
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
    everPrompted = true
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

// 設定画面の「インストール診断」用に、現在のインストール状態をまとめて購読する。
// 非エンジニアのユーザーが、Android で「ショートカットにしかならない（WebAPK にならない）」
// 原因を自分で読み取って報告できるようにするための表示。
export interface PwaDiag {
  // ブラウザが「インストール可能」と判断して beforeinstallprompt を出したか。
  // true=このブラウザ的にはインストール可能。false=条件未達／未対応／既にインストール済み。
  installable: boolean
  // これまで一度でも beforeinstallprompt が発火したか（今は消費済みでも履歴として true）。
  everPrompted: boolean
  // appinstalled を受け取ったか（この画面を開いている間にインストールが完了したか）。
  installed: boolean
  // 現在この画面がインストール済みアプリ（スタンドアロン表示）として開かれているか。
  standalone: boolean
}
export function usePwaDiag(): PwaDiag {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    // getSnapshot は同期・参照安定が必要だが、standalone は matchMedia の即時評価で毎回同じ真偽になる。
    // ただしオブジェクトを毎回作ると無限再描画になるため、キャッシュして内容が変わった時だけ差し替える。
    () => getDiagSnapshot(),
    () => diagCacheDefault,
  )
}
const diagCacheDefault: PwaDiag = {
  installable: false,
  everPrompted: false,
  installed: false,
  standalone: false,
}
let diagCache: PwaDiag = diagCacheDefault
function getDiagSnapshot(): PwaDiag {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  const next: PwaDiag = {
    installable: deferred !== null && !installed,
    everPrompted,
    installed,
    standalone,
  }
  // 中身が同じなら前回と同じ参照を返す（useSyncExternalStore の再描画ループ防止）。
  if (
    diagCache.installable === next.installable &&
    diagCache.everPrompted === next.everPrompted &&
    diagCache.installed === next.installed &&
    diagCache.standalone === next.standalone
  ) {
    return diagCache
  }
  diagCache = next
  return next
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
