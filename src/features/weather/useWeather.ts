// 天気を取得する TanStack Query フック。
// Open-Meteo は認証不要なので Google のログイン状態に関係なく動く（パネルが表示される密度型でのみ
// マウントされる＝実質そのときだけ取得）。天気は頻繁に変わらないため 30分キャッシュ＋30分ポーリング。
import { useQuery } from '@tanstack/react-query'
import { fetchWeather } from './api'

export function useWeather() {
  return useQuery({
    queryKey: ['weather', 'tokyo'],
    queryFn: fetchWeather,
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  })
}
