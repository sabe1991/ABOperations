// ニュースを取得する（APIキー不要・CORS 対応・JSON 直取り）。TODO#16 の「RSS リーダー」は
// ブラウザ直 fetch だと CORS で弾かれるフィードが多く実装が重いため、鍵なしで CORS 対応の
// JSON API を叩く方式（天気の Open-Meteo と同じ発想）に切り替えた。ソースは2つ:
//   - Qiita（日本語の技術記事。未認証で 60req/h・CORS 対応）
//   - Hacker News（技術・スタートアップ系の英語ニュース。Firebase API は鍵なし・完全CORS対応）
// 将来 NHK 等の一般ニュース（RSS）を足す場合は TODO#16 の B 案（RSS→JSON 変換 or 中継サーバー）を参照。
import type { NewsSource } from './newsSource'

// 画面に渡す整形済みニュース1件。ソース差（Qiita/HN）を吸収した共通形。
export interface NewsItem {
  id: string
  title: string
  url: string // 記事本体（クリックで別タブ）
  author?: string // Qiita: 投稿者ID / HN: by
  points?: number // Qiita: いいね数 / HN: スコア
  comments?: number // コメント数（HN は descendants、Qiita は comments_count）
  dateMs: number // 投稿時刻（相対表示に使う）
}

// ソースに応じて取得する。パネルはこの1本だけ呼べばよい。
export async function fetchNews(source: NewsSource): Promise<NewsItem[]> {
  return source === 'hn' ? fetchHackerNews() : fetchQiita()
}

// --- Qiita ---------------------------------------------------------------

interface QiitaItem {
  id: string
  title: string
  url: string
  likes_count?: number
  comments_count?: number
  created_at: string // ISO8601
  user?: { id?: string }
}

async function fetchQiita(): Promise<NewsItem[]> {
  // 未認証でも公開記事の一覧は取得できる（新着順・IPあたり60req/h）。鍵は付けない。
  const res = await fetch('https://qiita.com/api/v2/items?page=1&per_page=20', {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Qiita の取得に失敗しました (HTTP ${res.status})`)
  const items = (await res.json()) as QiitaItem[]
  return items.map((it) => ({
    id: `qiita-${it.id}`,
    title: it.title,
    url: it.url,
    author: it.user?.id,
    points: it.likes_count,
    comments: it.comments_count,
    dateMs: Date.parse(it.created_at) || 0,
  }))
}

// --- Hacker News ---------------------------------------------------------

interface HnItem {
  id: number
  title?: string
  url?: string
  score?: number
  by?: string
  time?: number // 秒
  descendants?: number
}

async function fetchHackerNews(): Promise<NewsItem[]> {
  // 1) トップ記事のID一覧（先頭20件だけ使う）。2) 各IDの詳細を並列取得。
  const topRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
  if (!topRes.ok) throw new Error(`Hacker News の取得に失敗しました (HTTP ${topRes.status})`)
  const ids = ((await topRes.json()) as number[]).slice(0, 20)

  const items = await Promise.all(
    ids.map(async (id): Promise<NewsItem | null> => {
      const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
      if (!r.ok) return null
      const it = (await r.json()) as HnItem | null
      if (!it || !it.title) return null
      return {
        id: `hn-${it.id}`,
        // 外部URLが無い投稿（Ask HN 等）はHNのスレッドを開く。
        title: it.title,
        url: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
        author: it.by,
        points: it.score,
        comments: it.descendants,
        dateMs: it.time ? it.time * 1000 : 0,
      }
    }),
  )
  // 取得に失敗した項目（null）は除き、元のトップ順を保つ。
  return items.filter((it): it is NewsItem => it !== null)
}
