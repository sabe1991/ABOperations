// 密度型の24hタイムライン（TodayTimeline）→ 予定パネル（CalendarPanel）へ、
// 「編集シートを開く」「時刻をプリフィルした作成シートを開く」を伝える軽量シグナル。
// 2つは別コンポーネントなので、scrollTarget / displayPrefs と同じ購読可能ストア方式で疎結合に伝える。
// シート開閉 state とミューテーション・Undoスナックは CalendarPanel 側にそのまま残す
// （CalendarPanel は全レイアウトで常時マウントされ、幅境界をまたいでも状態を失わないため／Fable 助言）。
import { useSyncExternalStore } from 'react'
import type { CalendarEvent } from './api'

// タイムラインから要求できる操作。
// - edit: 既存予定の編集シートを開く（書き込み可能な予定のみ）。
// - create: 指定した今日の時間帯をプリフィルした作成シートを開く（#17 Phase A のドラッグ作成）。
export type SheetRequest =
  | { kind: 'edit'; event: CalendarEvent }
  | { kind: 'create'; startDate: string; startTime: string; endTime: string }

let request: SheetRequest | null = null
let seq = 0 // 同じ要求を続けて出しても発火するよう連番を持つ（スナップショットはこの数値）
const listeners = new Set<() => void>()

// タイムライン側から呼ぶ: 既存予定の編集シートを開く。
export function requestEditEvent(event: CalendarEvent): void {
  request = { kind: 'edit', event }
  seq++
  for (const listener of listeners) listener()
}

// タイムライン側から呼ぶ: 今日の startTime〜endTime をプリフィルした作成シートを開く。
export function requestCreateEventAt(startDate: string, startTime: string, endTime: string): void {
  request = { kind: 'create', startDate, startTime, endTime }
  seq++
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// 予定パネル側で購読する。seq が変わるたびに request の内容でシートを開く（useEffect の依存に seq を使う）。
// スナップショットは数値 seq（安定値）にし、request は別途参照する（オブジェクトを返すと毎回新参照で無限ループになる）。
export function useCalendarSheetSignal(): { request: SheetRequest | null; seq: number } {
  const s = useSyncExternalStore(subscribe, () => seq)
  return { request, seq: s }
}
