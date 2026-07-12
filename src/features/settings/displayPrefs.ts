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
