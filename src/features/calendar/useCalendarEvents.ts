// カレンダー予定を取得する TanStack Query フック。
//
// 要件の対応:
// - 5分ポーリング → refetchInterval
// - 画面復帰時更新 → queryClient の refetchOnWindowFocus（既定で有効）
// - 401でポーリング停止 → enabled を「接続済み かつ 再接続不要」に紐づける。
//   401検知時は authStore が needsReconnect=true にするため enabled が false になり自動停止する。

import { useIsMutating, useQuery } from '@tanstack/react-query'
import {
  fetchCalendarList,
  fetchEventDaysInRange,
  fetchUpcomingEvents,
  toWritableCalendars,
} from './api'
import { useAuth } from '../../auth/useAuth'

// カレンダー構成はあまり変わらないので長めに保持する。
const CALENDAR_LIST_STALE = 30 * 60 * 1000

// 全機能で共有するカレンダー一覧（id・色・権限・selected 等を含む生データ）の共有クエリ（#32）。
// 予定取得・月ドット・作成先一覧・アカウントメールがこれを参照し、`calendarList` の二重取得を無くす。
export function useCalendarList() {
  const { isConnected, needsReconnect } = useAuth()
  return useQuery({
    queryKey: ['calendar', 'list'],
    queryFn: fetchCalendarList,
    enabled: isConnected && !needsReconnect,
    staleTime: CALENDAR_LIST_STALE,
  })
}

export function useCalendarEvents() {
  const { isConnected, needsReconnect } = useAuth()
  // 共有のカレンダー一覧を再利用する（予定はこの一覧を渡して各カレンダーぶんを取得する）。
  const { data: calendars } = useCalendarList()
  // 書き込み(作成/編集/削除)実行中はポーリングを止め、楽観的更新の一瞬を上書きしない。
  const mutating = useIsMutating() > 0
  return useQuery({
    queryKey: ['calendar', 'upcoming'],
    queryFn: () => fetchUpcomingEvents(calendars ?? []),
    // ログイン済み・認証切れでない・カレンダー一覧が揃ったときだけ動かす
    enabled: isConnected && !needsReconnect && !!calendars,
    // 前面にいる間の定期更新（5分間隔）
    refetchInterval: mutating ? false : 5 * 60 * 1000,
  })
}

// 月ミニカレンダーのドット用。グリッドの開始〜終了（排他的）の日付文字列でキャッシュを分ける。
// 7日リストとは別クエリだが、カレンダー一覧は共有クエリから受け取る。実行中はポーリングを止める。
export function useMonthEventDays(gridStartStr: string, gridEndExclusiveStr: string) {
  const { isConnected, needsReconnect } = useAuth()
  const { data: calendars } = useCalendarList()
  const mutating = useIsMutating() > 0
  return useQuery({
    queryKey: ['calendar', 'monthDays', gridStartStr, gridEndExclusiveStr],
    queryFn: () => fetchEventDaysInRange(calendars ?? [], gridStartStr, gridEndExclusiveStr),
    enabled: isConnected && !needsReconnect && !!calendars,
    refetchInterval: mutating ? false : 5 * 60 * 1000,
  })
}

// 予定を作成できるカレンダー（owner/writer）の一覧。作成フォームの選択肢に使う。
// 共有クエリ（['calendar','list']）を select で絞るだけなので追加取得は起きない（#32）。
export function useWritableCalendars() {
  const { isConnected, needsReconnect } = useAuth()
  return useQuery({
    queryKey: ['calendar', 'list'],
    queryFn: fetchCalendarList,
    enabled: isConnected && !needsReconnect,
    staleTime: CALENDAR_LIST_STALE,
    select: toWritableCalendars,
  })
}
