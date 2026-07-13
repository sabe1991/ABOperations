// ニュースを取得する TanStack Query フック。天気（useWeather）と同じ考え方:
// メール非表示時にニュースパネルがマウントされたときだけ取得する。ニュースは頻繁には
// 変わらないため 10分キャッシュ＋15分ポーリング。ソースを queryKey に含めるので、
// タブで Qiita ⇄ Hacker News を切り替えると自動で取得し直す（各ソースのキャッシュは別々に保つ）。
import { useQuery } from '@tanstack/react-query'
import { fetchNews } from './api'
import type { NewsSource } from './newsSource'

export function useNews(source: NewsSource, active: boolean) {
  return useQuery({
    queryKey: ['news', source],
    queryFn: () => fetchNews(source),
    enabled: active, // メール非表示（ニュース表示）時だけ取得する
    staleTime: 10 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  })
}
