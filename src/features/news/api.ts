// ニュースを取得する（APIキー不要・CORS 対応・JSON 直取り）。ブラウザから直接叩ける
// （＝ Access-Control-Allow-Origin が返る）鍵なしの JSON API だけを使う（天気の Open-Meteo と同じ発想）。
// 日本語ソースを優先しつつ、技術系に偏らないよう一般・科学系も混ぜている:
//   - Qiita        … 日本語の技術記事（未認証で 60req/h・CORS 対応）
//   - Wikipedia    … 日本語版ウィキペディアの「今アクセスの多い記事／今日の秀逸な記事」（一般教養。REST API は CORS 対応）
//   - 地震情報      … 気象庁の最近の地震（防災 JSON。日本語・CORS 対応）
//   - Hacker News  … 技術・スタートアップ系の英語ニュース（Firebase API は鍵なし・完全CORS対応）
//   - 宇宙ニュース   … 宇宙開発の英語ニュース（Spaceflight News API v4・鍵なし・CORS 対応）
// 追加する場合は newsSource.ts の NEWS_SOURCES にキー・表示名を足し、ここの fetchNews に分岐を足す。
import { fulfilledValues, mapPool, throwIfAllRejected } from '../../google/pool'
import type { NewsSource } from './newsSource'

// Hacker News の各記事詳細を取る同時実行数の上限。20件を一斉に投げず少数ずつ流す。
const HN_FETCH_CONCURRENCY = 8

// 画面に渡す整形済みニュース1件。ソース差（Qiita/HN/…）を吸収した共通形。
export interface NewsItem {
  id: string
  title: string
  url: string // 記事本体（クリックで別タブ）
  author?: string // 投稿者・提供元など（Qiita: 投稿者ID / HN: by / 宇宙: 媒体名）
  points?: number // 人気度（Qiita: いいね数 / HN: スコア）。無いソースは省略。
  comments?: number // コメント数（HN は descendants、Qiita は comments_count）
  dateMs: number // 投稿時刻（相対表示に使う）。無いソースは 0。
}

// ソースに応じて取得する。パネルはこの1本だけ呼べばよい。
export async function fetchNews(source: NewsSource): Promise<NewsItem[]> {
  switch (source) {
    case 'hn':
      return fetchHackerNews()
    case 'wikipedia':
      return fetchWikipedia()
    case 'quake':
      return fetchQuakes()
    case 'space':
      return fetchSpace()
    case 'qiita':
    default:
      return fetchQiita()
  }
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

  // 各記事の詳細を同時実行数を絞って取得する。1件の瞬断（fetch 失敗）で20件全体を
  // 落とさないよう、部分失敗を許容して成功分だけ採用する（元のトップ順は保たれる）。
  const settled = await mapPool(ids, HN_FETCH_CONCURRENCY, async (id): Promise<NewsItem | null> => {
    const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
    if (!r.ok) throw new Error(`HN item ${id} の取得に失敗 (HTTP ${r.status})`)
    const it = (await r.json()) as HnItem | null
    if (!it || !it.title) return null // タイトルの無い項目（削除済み等）はスキップ
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
  })
  // 全件失敗（例: ネットワーク全断）のときだけエラーにして、パネルに再試行を出す。
  throwIfAllRejected(settled)
  // 取得できた項目のうち、内容のあるもの（null でない）だけを返す。
  return fulfilledValues(settled).filter((it): it is NewsItem => it !== null)
}

// --- Wikipedia（日本語・注目記事）----------------------------------------

interface WikiArticle {
  title?: string
  titles?: { normalized?: string }
  views?: number
  timestamp?: string // tfa 側にある更新時刻
  content_urls?: { desktop?: { page?: string } }
}
interface WikiFeatured {
  tfa?: WikiArticle // 今日の秀逸な記事（1件）
  mostread?: { date?: string; articles?: WikiArticle[] } // 今アクセスの多い記事
}

// 前日(UTC)の日付を YYYY/MM/DD で返す。当日分はまだ生成されず 404 になることがあるため前日を使う。
function wikiFeedDate(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}/${m}/${day}`
}

function wikiItem(a: WikiArticle, dateMs: number): NewsItem | null {
  const title = a.titles?.normalized || a.title
  if (!title) return null
  const url = a.content_urls?.desktop?.page || `https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}`
  return {
    id: `wiki-${title}`,
    title,
    url,
    points: a.views, // 閲覧数（▲で表示）
    dateMs,
  }
}

async function fetchWikipedia(): Promise<NewsItem[]> {
  // 日本語版ウィキペディアの「注目のコンテンツ」フィード（鍵不要・CORS 対応）。
  const res = await fetch(
    `https://ja.wikipedia.org/api/rest_v1/feed/featured/${wikiFeedDate()}`,
    { headers: { Accept: 'application/json' } },
  )
  if (!res.ok) throw new Error(`Wikipedia の取得に失敗しました (HTTP ${res.status})`)
  const data = (await res.json()) as WikiFeatured
  // mostread の集計日を投稿日として使う（無ければ 0＝時刻非表示）。
  const dateMs = data.mostread?.date ? Date.parse(data.mostread.date) || 0 : 0
  const out: NewsItem[] = []
  // 先頭に「今日の秀逸な記事」、続けて「今アクセスの多い記事」。
  if (data.tfa) {
    const t = wikiItem(data.tfa, Date.parse(data.tfa.timestamp || '') || dateMs)
    if (t) out.push(t)
  }
  for (const a of data.mostread?.articles ?? []) {
    const it = wikiItem(a, dateMs)
    if (it) out.push(it)
  }
  // タイトル重複（tfa と mostread が同じ等）を除いて先頭20件。
  const seen = new Set<string>()
  return out.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true))).slice(0, 20)
}

// --- 地震情報（気象庁）---------------------------------------------------

interface JmaQuake {
  eid?: string // 地震ID（同一地震で複数報が来るので重複排除に使う）
  anm?: string // 震源地名
  mag?: string // マグニチュード（文字列。震度速報などでは空）
  maxi?: string // 最大震度コード（"1".."7" / "5-" / "5+" 等）
  at?: string // 発生時刻 ISO8601
  ttl?: string // 情報種別（震源・震度情報 など）
}

// 震度コードを日本語表記へ（5-→5弱 など）。該当なしはそのまま返す。
const JMA_INTENSITY: Record<string, string> = {
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5-': '5弱',
  '5+': '5強',
  '6-': '6弱',
  '6+': '6強',
  '7': '7',
}

async function fetchQuakes(): Promise<NewsItem[]> {
  // 気象庁の防災情報 JSON（鍵不要・CORS 対応）。最近の地震が新しい順に並ぶ。
  const res = await fetch('https://www.jma.go.jp/bosai/quake/data/list.json', {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`地震情報の取得に失敗しました (HTTP ${res.status})`)
  const list = (await res.json()) as JmaQuake[]
  const seen = new Set<string>()
  const out: NewsItem[] = []
  for (const q of list) {
    // 震源地が分かる「震源・震度情報」系だけを対象にし、同一地震の続報は最初の1件に集約。
    if (!q.anm || !q.eid || seen.has(q.eid)) continue
    seen.add(q.eid)
    const parts: string[] = [q.anm]
    if (q.mag && q.mag !== '不明') parts.push(`M${q.mag}`)
    const intensity = q.maxi ? JMA_INTENSITY[q.maxi] || q.maxi : ''
    if (intensity) parts.push(`最大震度${intensity}`)
    out.push({
      id: `jma-${q.eid}`,
      title: parts.join('　'),
      // 個別ページは無いので、気象庁の地震情報マップ（最近の地震一覧）を開く。
      url: 'https://www.jma.go.jp/bosai/map.html#contents=earthquake_map',
      author: q.ttl,
      dateMs: Date.parse(q.at || '') || 0,
    })
    if (out.length >= 20) break
  }
  return out
}

// --- 宇宙ニュース（Spaceflight News）------------------------------------

interface SpaceArticle {
  id: number
  title: string
  url: string
  news_site?: string
  published_at?: string // ISO8601
}
interface SpaceResponse {
  results?: SpaceArticle[]
}

async function fetchSpace(): Promise<NewsItem[]> {
  // 宇宙開発の英語ニュース集約 API v4（鍵不要・CORS 対応）。
  const res = await fetch('https://api.spaceflightnewsapi.net/v4/articles/?limit=20', {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`宇宙ニュースの取得に失敗しました (HTTP ${res.status})`)
  const data = (await res.json()) as SpaceResponse
  return (data.results ?? []).map((it) => ({
    id: `space-${it.id}`,
    title: it.title,
    url: it.url,
    author: it.news_site,
    dateMs: Date.parse(it.published_at || '') || 0,
  }))
}
