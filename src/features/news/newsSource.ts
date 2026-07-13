// ニュースパネルのソース設定（端末ローカル・localStorage）。2種類の設定を持つ:
//   1. 選択ソース（最大3つ）… 設定画面で選ぶ「パネルに出したいソース」の一覧。
//   2. 表示中ソース          … 上の選択の中で、いまパネルのタブで開いているソース。
// どちらも enabled.ts と同じく単なる localStorage 読み書きではなく購読可能な小さなストアにして、
// 設定変更やタブ切替を即座にパネルへ反映する（useSyncExternalStore）。
//
// ソースはいずれも APIキー不要・CORS 対応・JSON 直取り（api.ts 参照）。追加するときは
// この NEWS_SOURCES にキー・表示名・説明を足し、api.ts の fetchNews に取得処理を足すだけでよい。

import { useSyncExternalStore } from 'react'

// 選べるニュースソースの一覧（キー・タブ表示名・設定画面用の短い説明）。
// as const で「キーの文字列リテラル型」を保ち、NewsSource 型をここから導出する。
export const NEWS_SOURCES = [
  { key: 'qiita', label: 'Qiita', description: '日本語の技術記事' },
  { key: 'wikipedia', label: 'Wikipedia 注目', description: '日本語版のいま話題の記事（一般教養）' },
  { key: 'quake', label: '地震情報', description: '気象庁の最近の地震（日本語）' },
  { key: 'hn', label: 'Hacker News', description: '英語の技術ニュース' },
  { key: 'space', label: '宇宙ニュース', description: '宇宙開発の話題（英語）' },
] as const

export type NewsSource = (typeof NEWS_SOURCES)[number]['key']

const SOURCE_KEYS = NEWS_SOURCES.map((s) => s.key) as NewsSource[]
function isNewsSource(v: unknown): v is NewsSource {
  return typeof v === 'string' && (SOURCE_KEYS as string[]).includes(v)
}

// 選択ソースは最大3つまで（タブが増えすぎて細い列で潰れないように）。
export const MAX_SELECTED_SOURCES = 3

// --- 選択ソース（最大3つ）------------------------------------------------

const SELECTED_KEY = 'abops:newsSources'
// 既定は従来どおり Qiita と Hacker News の2つ（この機能導入前の挙動を保つ）。
const DEFAULT_SELECTED: NewsSource[] = ['qiita', 'hn']

function readSelected(): NewsSource[] {
  try {
    const raw = localStorage.getItem(SELECTED_KEY)
    if (!raw) return [...DEFAULT_SELECTED]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_SELECTED]
    // 未知キー・重複を除き、最大数で切り詰める。空になったら既定へ戻す。
    const cleaned = parsed.filter(isNewsSource).filter((v, i, a) => a.indexOf(v) === i)
    return cleaned.length > 0 ? cleaned.slice(0, MAX_SELECTED_SOURCES) : [...DEFAULT_SELECTED]
  } catch {
    return [...DEFAULT_SELECTED]
  }
}

let selected = readSelected()
const selectedListeners = new Set<() => void>()

export function getSelectedNewsSources(): NewsSource[] {
  return selected
}

// 選択ソースを保存する。最低1つ・最大3つに正規化してから保存する。
export function setSelectedNewsSources(next: NewsSource[]): void {
  const cleaned = next.filter(isNewsSource).filter((v, i, a) => a.indexOf(v) === i)
  const normalized = (cleaned.length > 0 ? cleaned : [...DEFAULT_SELECTED]).slice(
    0,
    MAX_SELECTED_SOURCES,
  )
  selected = normalized
  try {
    localStorage.setItem(SELECTED_KEY, JSON.stringify(normalized))
  } catch {
    // localStorage が使えない環境でもメモリ上の値で動作継続
  }
  for (const listener of selectedListeners) listener()
}

function subscribeSelected(listener: () => void): () => void {
  selectedListeners.add(listener)
  return () => selectedListeners.delete(listener)
}

export function useSelectedNewsSources(): NewsSource[] {
  return useSyncExternalStore(subscribeSelected, getSelectedNewsSources)
}

// --- 表示中ソース（タブで開いている1つ）----------------------------------

const KEY = 'abops:newsSource'

function read(): NewsSource {
  try {
    const v = localStorage.getItem(KEY)
    return isNewsSource(v) ? v : selected[0]
  } catch {
    return selected[0]
  }
}

let source = read()
const listeners = new Set<() => void>()

export function getNewsSource(): NewsSource {
  return source
}

export function setNewsSource(value: NewsSource): void {
  source = value
  try {
    localStorage.setItem(KEY, value)
  } catch {
    // localStorage が使えない環境でもメモリ上の値で動作継続
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// React から現在のソースを購読する。タブで切り替えるとパネルも即再描画される。
export function useNewsSource(): NewsSource {
  return useSyncExternalStore(subscribe, getNewsSource)
}
