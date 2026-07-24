// 表示に関する端末ローカルの設定（localStorage）。gmail の enabled.ts と同じ方式で、
// 設定モーダルと各パネルの両方から参照・変更でき、変更が即反映されるよう購読可能にする。
//
// showSourceLabels: 予定の「カレンダー名（主カレンダーだとメールアドレス）」と
//   タスクの「リスト名」を表示するか。既定は false（非表示）。個人利用では出典名は
//   ノイズになりやすいという要望による。

import { useSyncExternalStore } from 'react'

const KEY = 'abops:showSourceLabels'

function read(): boolean {
  try {
    // 明示的に '1' のときだけ true。未設定（null）は既定の false。
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

let showSourceLabels = read()
const listeners = new Set<() => void>()

export function getShowSourceLabels(): boolean {
  return showSourceLabels
}

export function setShowSourceLabels(value: boolean): void {
  showSourceLabels = value
  try {
    if (value) localStorage.setItem(KEY, '1')
    else localStorage.setItem(KEY, '0')
  } catch {
    // localStorage が使えなくてもメモリ上の値で動作継続
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// React から現在値を購読する。設定側で切り替えると各パネルも即再描画される。
export function useShowSourceLabels(): boolean {
  return useSyncExternalStore(subscribe, getShowSourceLabels)
}

// showExternalImages: メール本文の外部画像（https:）を既定で表示するか。既定は true（表示）。
// 外部画像の自動読み込みは送信者に開封（時刻・IP＝おおよその所在地・端末情報）を伝える
// 「開封トラッキング」を許すが、個人利用では見やすさを優先して既定 ON にする（ユーザー要望）。
// OFF にすると従来どおりブロックし、本文の「画像を表示」ボタンでその場だけ解禁できる。
// ※埋め込み画像（cid: をデータURI化したもの）はこの設定に関わらず常に表示（外部通信を伴わないため）。
const SHOW_EXT_IMAGES_KEY = 'abops:showExternalImages'

function readShowExternalImages(): boolean {
  try {
    // 既定 true。明示的に '0'（OFF）のときだけ false にする（showSourceLabels とは既定が逆）。
    return localStorage.getItem(SHOW_EXT_IMAGES_KEY) !== '0'
  } catch {
    return true
  }
}

let showExternalImages = readShowExternalImages()
const showExtImagesListeners = new Set<() => void>()

export function getShowExternalImages(): boolean {
  return showExternalImages
}

export function setShowExternalImages(value: boolean): void {
  showExternalImages = value
  try {
    localStorage.setItem(SHOW_EXT_IMAGES_KEY, value ? '1' : '0')
  } catch {
    // localStorage が使えなくてもメモリ上の値で動作継続
  }
  for (const listener of showExtImagesListeners) listener()
}

function subscribeShowExtImages(listener: () => void): () => void {
  showExtImagesListeners.add(listener)
  return () => showExtImagesListeners.delete(listener)
}

export function useShowExternalImages(): boolean {
  return useSyncExternalStore(subscribeShowExtImages, getShowExternalImages)
}

// weekStart: 月ミニカレンダーの週の開始曜日。0=日曜始まり（既定）, 1=月曜始まり。
export type WeekStart = 0 | 1
const WEEK_START_KEY = 'abops:weekStart'

function readWeekStart(): WeekStart {
  try {
    return localStorage.getItem(WEEK_START_KEY) === '1' ? 1 : 0
  } catch {
    return 0
  }
}

let weekStart: WeekStart = readWeekStart()
const weekStartListeners = new Set<() => void>()

export function getWeekStart(): WeekStart {
  return weekStart
}

export function setWeekStart(value: WeekStart): void {
  weekStart = value
  try {
    localStorage.setItem(WEEK_START_KEY, String(value))
  } catch {
    // localStorage が使えなくてもメモリ上の値で動作継続
  }
  for (const listener of weekStartListeners) listener()
}

function subscribeWeekStart(listener: () => void): () => void {
  weekStartListeners.add(listener)
  return () => weekStartListeners.delete(listener)
}

export function useWeekStart(): WeekStart {
  return useSyncExternalStore(subscribeWeekStart, getWeekStart)
}

// theme: 画面の明暗（配色テーマ）。'system'=OS の設定に従う（既定）, 'light'=常に明るい, 'dark'=常に暗い。
// 仕組み: CSS 側は色を light-dark() で定義しており、これは要素の color-scheme プロパティを見て
// 明色/暗色のどちらを使うかを決める。そこで documentElement（<html>）の color-scheme を
// JS で上書きすることで、OS 設定に関係なくアプリ全体の明暗を強制できる。
// 'system' のときは上書きを外し、CSS の既定（:root の color-scheme: light dark＝OS 追従）に戻す。
export type Theme = 'system' | 'light' | 'dark'
const THEME_KEY = 'abops:theme'

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

// アプリ背景色（index.html / manifest の theme_color と一致させる）。Android のステータスバー色に反映。
const THEME_COLOR_LIGHT = '#faf9f5'
const THEME_COLOR_DARK = '#161513'

// Android のステータスバー/ナビ領域の色（theme-color メタ）をテーマに合わせて上書きする。
// index.html には OS 追従用の media 付きメタが2つある。手動テーマ時は両方を同色にして
// どちらがマッチしても選択テーマの色になるようにし、'system' 時は本来の明暗色に戻す。
function applyThemeColor(theme: Theme): void {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  metas.forEach((meta) => {
    const media = meta.getAttribute('media') || ''
    const isDarkMeta = media.includes('dark')
    if (theme === 'system') {
      meta.setAttribute('content', isDarkMeta ? THEME_COLOR_DARK : THEME_COLOR_LIGHT)
    } else {
      meta.setAttribute('content', theme === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT)
    }
  })
}

// <html> の color-scheme を設定値に合わせて上書き/解除する。light-dark() の解決に影響する。
function applyTheme(theme: Theme): void {
  const root = document.documentElement
  // 'system' は空文字で inline 指定を消し、CSS の :root（OS 追従）に委ねる。
  root.style.colorScheme = theme === 'system' ? '' : theme
  applyThemeColor(theme)
}

let theme: Theme = readTheme()
const themeListeners = new Set<() => void>()

export function getTheme(): Theme {
  return theme
}

export function setTheme(value: Theme): void {
  theme = value
  try {
    localStorage.setItem(THEME_KEY, value)
  } catch {
    // localStorage が使えなくてもメモリ上の値で動作継続
  }
  applyTheme(value)
  for (const listener of themeListeners) listener()
}

function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener)
  return () => themeListeners.delete(listener)
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getTheme)
}

// 実効的にダークかどうか（theme='dark'、または theme='system' で OS がダーク）。
// CSS の light-dark() で表せない箇所（iframe 内メール本文の背景色など）の判定に使う。
function osPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}
function subscribeOsDark(listener: () => void): () => void {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  } catch {
    return () => {}
  }
}
export function useEffectiveDark(): boolean {
  const t = useTheme()
  const osDark = useSyncExternalStore(subscribeOsDark, osPrefersDark, () => false)
  if (t === 'dark') return true
  if (t === 'light') return false
  return osDark
}

// 起動時に保存済みテーマを <html> へ適用する。main.tsx から描画前に呼び、初回の明暗のちらつきを防ぐ。
export function initTheme(): void {
  applyTheme(theme)
}
