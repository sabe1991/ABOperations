// 「ニュースパネルで今どのソースを表示しているか」の端末ローカル設定（localStorage）。
//
// メール非表示時に Gmail パネルの代わりに出すニュースパネルで、Qiita と Hacker News を
// タブで切り替える。その選択を端末に覚えさせ、リロードしても前回のソースで開くようにする。
// enabled.ts と同じく、単なる localStorage 読み書きではなく購読可能な小さなストアにして、
// タブ切替を即座にパネルへ反映する（useSyncExternalStore）。

import { useSyncExternalStore } from 'react'

export type NewsSource = 'qiita' | 'hn'

const KEY = 'abops:newsSource'
const DEFAULT: NewsSource = 'qiita' // 日本語ユーザー向けに Qiita を既定にする

function read(): NewsSource {
  try {
    return localStorage.getItem(KEY) === 'hn' ? 'hn' : 'qiita'
  } catch {
    return DEFAULT
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
