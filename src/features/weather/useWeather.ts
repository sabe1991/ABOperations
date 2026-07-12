// 天気を取得する TanStack Query フック。
// Open-Meteo は認証不要なので Google のログイン状態に関係なく動く（パネルが表示される密度型でのみ
// マウントされる＝実質そのときだけ取得）。天気は頻繁に変わらないため 30分キャッシュ＋30分ポーリング。
// 地点（緯度経度）を queryKey に含めるので、設定で地点を変えると自動で取得し直す。
import { useQuery } from '@tanstack/react-query'
import { fetchWeather } from './api'
import { useWeatherLocation } from './location'

export function useWeather() {
  const loc = useWeatherLocation()
  return useQuery({
    queryKey: ['weather', loc.latitude, loc.longitude],
    queryFn: () => fetchWeather(loc),
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  })
}
