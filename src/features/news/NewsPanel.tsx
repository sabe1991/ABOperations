// ニュースパネル。メール（Gmail）を非表示にしている端末で、Gmail パネルの代わりに出す。
// Qiita（日本語の技術記事）と Hacker News（英語の技術ニュース）をタブで切り替えて一覧表示する。
// 各記事はクリックで別タブに開く（読むだけの一覧なので操作は最小限）。
// ※ Gmail を再表示したいときは設定（⚙）の「メール（Gmail）を表示」から切り替える。
import { useNews } from './useNews'
import { setNewsSource, useNewsSource } from './newsSource'
import type { NewsSource } from './newsSource'
import type { NewsItem } from './api'
import { ListSkeleton } from '../../Skeleton'

const SOURCES: { key: NewsSource; label: string }[] = [
  { key: 'qiita', label: 'Qiita' },
  { key: 'hn', label: 'Hacker News' },
]

// 投稿時刻の相対表示（例: たった今 / 3分前 / 5時間前 / 2日前）。細い列に収まる短い形にする。
function formatRelative(dateMs: number): string {
  if (!dateMs) return ''
  const diff = Date.now() - dateMs
  if (diff < 0) return 'たった今'
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}時間前`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day}日前`
  return `${Math.floor(day / 7)}週間前`
}

export function NewsPanel() {
  const source = useNewsSource()
  const { data, isLoading, isError, error } = useNews(source, true)

  return (
    <div className="news">
      {/* ソース切替タブ（Qiita / Hacker News）。 */}
      <div className="news__tabs" role="tablist" aria-label="ニュースソース切替">
        {SOURCES.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={source === s.key}
            className={`news__tab${source === s.key ? ' news__tab--active' : ''}`}
            onClick={() => setNewsSource(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <NewsList data={data} isLoading={isLoading} isError={isError} error={error} />
    </div>
  )
}

function NewsList({
  data,
  isLoading,
  isError,
  error,
}: {
  data: NewsItem[] | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
}) {
  if (isLoading && !data) return <ListSkeleton rows={6} />
  if (isError)
    return (
      <p className="panel__note panel__note--error">
        ニュースの取得に失敗しました: {String(error)}
      </p>
    )
  if (!data || data.length === 0)
    return <p className="panel__note">表示できるニュースがありません。</p>

  return (
    <ul className="news__list">
      {data.map((it) => (
        <li key={it.id} className="news__item">
          <a className="news__link" href={it.url} target="_blank" rel="noopener noreferrer">
            <span className="news__title">{it.title}</span>
            <span className="news__meta">
              {it.points != null && <span className="news__pts">▲{it.points}</span>}
              {it.comments != null && <span className="news__cmt">💬{it.comments}</span>}
              {it.author && <span className="news__author">{it.author}</span>}
              {it.dateMs > 0 && <span className="news__when">{formatRelative(it.dateMs)}</span>}
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}
