// 月カレンダーで選択した日付を、タイムライン（TodayTimeline）と共有するための軽量ストア。
// scrollTarget.ts と同じ購読可能ストア方式で疎結合に伝える。
// 既定は null（＝「今日」）で、タイムライン側が null を今日として解釈する。
// null を既定にするのは、アプリを日付をまたいで開きっぱなしにしても「既定＝常に当日」を保つため
// （モジュール読込時の日付で固定しない）。ユーザーが日付を選ぶと明示的な 'YYYY-MM-DD' が入る。
import { useSyncExternalStore } from 'react'

let selected: string | null = null // 選択中の日付 'YYYY-MM-DD'。null は「今日」。
const listeners = new Set<() => void>()

// 月カレンダー側から呼ぶ。タイムラインの表示日を切り替える。
export function setSelectedDate(dateStr: string): void {
  if (selected === dateStr) return
  selected = dateStr
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// タイムライン・月カレンダーで購読する。選択中の日付（未選択なら null＝今日）を返す。
export function useSelectedDate(): string | null {
  return useSyncExternalStore(subscribe, () => selected)
}
