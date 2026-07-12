// カレンダー予定を取得する TanStack Query フック。
//
// 要件の対応:
// - 5分ポーリング → refetchInterval
// - 画面復帰時更新 → queryClient の refetchOnWindowFocus（既定で有効）
// - 401でポーリング停止 → enabled を「接続済み かつ 再接続不要」に紐づける。
//   401検知時は authStore が needsReconnect=true にするため enabled が false になり自動停止する。

import { useIsMutating, useQuery } from '@tanstack/react-query'
import { fetchUpcomingEvents, fetchWritableCalendars } from './api'
import { useAuth } from '../../auth/useAuth'

export function useCalendarEvents() {
  const { isConnected, needsReconnect } = useAuth()
  // 書き込み(作成/編集/削除)実行中はポーリングを止め、楽観的更新の一瞬を上書きしない。
  const mutating = useIsMutating() > 0
  return useQuery({
    queryKey: ['calendar', 'upcoming'],
    queryFn: fetchUpcomingEvents,
    // ログイン済みで、かつ認証切れでないときだけ動かす
    enabled: isConnected && !needsReconnect,
    // 前面にいる間の定期更新（5分間隔）
    refetchInterval: mutating ? false : 5 * 60 * 1000,
  })
}

// 予定を作成できるカレンダー（owner/writer）の一覧。作成フォームの選択肢に使う。
// あまり変わらないので長め（30分）にキャッシュする。
export function useWritableCalendars() {
  const { isConnected, needsReconnect } = useAuth()
  return useQuery({
    queryKey: ['calendar', 'writableList'],
    queryFn: fetchWritableCalendars,
    enabled: isConnected && !needsReconnect,
    staleTime: 30 * 60 * 1000,
  })
}
