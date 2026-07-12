// 月ミニカレンダーの日付クリック → 予定パネルをその日へスクロールさせるための軽量シグナル。
// 2つは別パネル（別コンポーネント）なので、displayPrefs と同じ購読可能ストア方式で疎結合に伝える。
import { useSyncExternalStore } from 'react'

let target: string | null = null // スクロール先の日付 'YYYY-MM-DD'
let seq = 0 // 同じ日付を続けて押しても発火するよう連番を持つ（スナップショットはこの数値）
const listeners = new Set<() => void>()

// 月カレンダー側から呼ぶ。予定パネルへ「この日へスクロール」を通知する。
export function requestScrollToDate(dateStr: string): void {
  target = dateStr
  seq++
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// 予定パネル側で購読する。seq が変わるたびに target の日付へスクロールする（useEffect の依存に seq を使う）。
// スナップショットは数値 seq（安定値）にし、target は別途参照する（オブジェクトを返すと毎回新参照で無限ループになる）。
export function useScrollToDateSignal(): { date: string | null; seq: number } {
  const s = useSyncExternalStore(subscribe, () => seq)
  return { date: target, seq: s }
}
