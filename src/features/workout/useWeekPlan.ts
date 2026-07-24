// 今週のメニュー（AB Workout の週間プラン）を取得する TanStack Query フック。
// 認証不要の公開URL（Secret Gist の raw）から取るので Google のログイン状態に依存しない。
// プランは1日に何度も変わるものではないため、天気と同様に 30分キャッシュ＋30分ポーリングにする。
import { useQuery } from '@tanstack/react-query'
import { fetchWeekPlan } from './api'

export function useWeekPlan() {
  return useQuery({
    queryKey: ['weekPlan'],
    queryFn: fetchWeekPlan,
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  })
}
