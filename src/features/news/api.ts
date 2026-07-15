// ニュースを取得する（APIキー不要・CORS 対応・JSON 直取り）。ブラウザから直接叩ける
// （＝ Access-Control-Allow-Origin が返る）鍵なしの JSON API だけを使う（天気の Open-Meteo と同じ発想）。
// 日本語ソースを優先しつつ、技術系に偏らないよう一般・科学系も混ぜている:
//   - Qiita        … 日本語の技術記事（未認証で 60req/h・CORS 対応）
//   - Wikipedia    … 日本語版ウィキペディアの「今アクセスの多い記事／今日の秀逸な記事」（一般教養。REST API は CORS 対応）
//   - 地震情報      … 気象庁の最近の地震（防災 JSON。日本語・CORS 対応）
//   - Hacker News  … 技術・スタートアップ系の英語ニュース（HN Algolia 検索API・鍵なし・CORS 対応）
//   - dev.to       … 英語の技術記事（公開APIは鍵なし・CORS 対応）
//   - GitHub       … 直近1週間で星を集めたリポジトリ（検索APIは鍵なしで 60req/h・CORS 対応）
//   - 宇宙ニュース   … 宇宙開発の英語ニュース（Spaceflight News API v4・鍵なし・CORS 対応）
// 追加する場合は newsSource.ts の NEWS_SOURCES にキー・表示名を足し、ここの fetchNews に分岐を足す。
import { asArray, asObject, fetchWithTimeout } from '../../fetchTimeout'
import type { NewsSource } from './newsSource'

// 各ソースから取る最大件数（パネルは一覧を流し読みする用途なので20件で足りる）。
const LIMIT = 20

// タイトル中の改行・連続空白を1つの半角スペースへ潰す。dev.to など投稿者が自由入力するソースでは
// タイトルに改行が混ざることがあり、そのままだと2行クランプの表示が崩れるため。
function normalizeTitle(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

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
    case 'devto':
      return fetchDevTo()
    case 'github':
      return fetchGitHub()
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
  const res = await fetchWithTimeout(`https://qiita.com/api/v2/items?page=1&per_page=${LIMIT}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Qiita の取得に失敗しました (HTTP ${res.status})`)
  const items = asArray<QiitaItem>(await res.json(), 'Qiita')
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

interface HnHit {
  objectID: string
  title?: string | null
  url?: string | null // 外部URLの無い投稿（Ask HN 等）は null
  author?: string
  points?: number | null
  num_comments?: number | null
  created_at_i?: number // 秒
}
interface HnResponse {
  hits?: HnHit[]
}

async function fetchHackerNews(): Promise<NewsItem[]> {
  // HN 公式の Firebase API はトップ記事のID一覧しか返さず、20件表示するのに詳細を20回
  // 追加取得する必要があった（計21リクエスト）。Algolia の検索APIは同じ内容を1回で返すため
  // こちらを使う（tags=front_page＝いまトップページに載っている記事）。
  const res = await fetchWithTimeout(
    `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${LIMIT}`,
    { headers: { Accept: 'application/json' } },
  )
  if (!res.ok) throw new Error(`Hacker News の取得に失敗しました (HTTP ${res.status})`)
  const data = asObject<HnResponse>(await res.json(), 'Hacker News')
  const out: NewsItem[] = []
  for (const it of data.hits ?? []) {
    if (!it.title) continue // タイトルの無い項目（削除済み等）はスキップ
    out.push({
      id: `hn-${it.objectID}`,
      title: normalizeTitle(it.title),
      // 外部URLが無い投稿（Ask HN 等）はHNのスレッドを開く。
      url: it.url || `https://news.ycombinator.com/item?id=${it.objectID}`,
      author: it.author,
      points: it.points ?? undefined,
      comments: it.num_comments ?? undefined,
      dateMs: it.created_at_i ? it.created_at_i * 1000 : 0,
    })
  }
  return out
}

// --- dev.to（英語の技術記事）--------------------------------------------

interface DevToArticle {
  id: number
  title?: string
  url?: string
  positive_reactions_count?: number
  comments_count?: number
  published_at?: string // ISO8601
  user?: { username?: string }
}

async function fetchDevTo(): Promise<NewsItem[]> {
  // 公開記事の一覧は鍵なしで取得できる（CORS 対応）。Qiita の英語版のような位置づけ。
  const res = await fetchWithTimeout(`https://dev.to/api/articles?per_page=${LIMIT}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`dev.to の取得に失敗しました (HTTP ${res.status})`)
  const items = asArray<DevToArticle>(await res.json(), 'dev.to')
  const out: NewsItem[] = []
  for (const it of items) {
    if (!it.title || !it.url) continue
    out.push({
      id: `devto-${it.id}`,
      title: normalizeTitle(it.title),
      url: it.url,
      author: it.user?.username,
      points: it.positive_reactions_count,
      comments: it.comments_count,
      dateMs: Date.parse(it.published_at || '') || 0,
    })
  }
  return out
}

// --- GitHub（直近1週間で星を集めたリポジトリ）----------------------------

interface GitHubRepo {
  id: number
  full_name?: string
  html_url?: string
  description?: string | null
  stargazers_count?: number
  language?: string | null
  created_at?: string // ISO8601
}
interface GitHubSearchResponse {
  items?: GitHubRepo[]
}

// 「直近1週間」の起点となる日付を YYYY-MM-DD で返す（GitHub 検索の created:>… に渡す形式）。
function githubSinceDate(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

async function fetchGitHub(): Promise<NewsItem[]> {
  // GitHub にトレンド用の公式APIは無いため、検索APIで「1週間以内に作られたリポジトリを
  // 星の多い順」に並べて代用する。鍵なしだとIPあたり 60req/h だが、パネルの更新頻度なら足りる。
  const q = encodeURIComponent(`created:>${githubSinceDate()}`)
  const res = await fetchWithTimeout(
    `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${LIMIT}`,
    { headers: { Accept: 'application/vnd.github+json' } },
  )
  if (!res.ok) throw new Error(`GitHub の取得に失敗しました (HTTP ${res.status})`)
  const data = asObject<GitHubSearchResponse>(await res.json(), 'GitHub')
  const out: NewsItem[] = []
  for (const it of data.items ?? []) {
    if (!it.full_name || !it.html_url) continue
    // リポジトリ名だけでは何のリポジトリか分からないので、説明文があれば続けて出す
    // （タイトルはCSSで2行までに省略される）。
    const desc = it.description?.trim()
    out.push({
      id: `gh-${it.id}`,
      title: desc ? `${it.full_name} — ${normalizeTitle(desc)}` : it.full_name,
      url: it.html_url,
      author: it.language ?? undefined, // 主要言語を提供元の位置に出す
      points: it.stargazers_count, // ▲＝星の数
      dateMs: Date.parse(it.created_at || '') || 0,
    })
  }
  return out
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
  const url =
    a.content_urls?.desktop?.page || `https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}`
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
  const res = await fetchWithTimeout(
    `https://ja.wikipedia.org/api/rest_v1/feed/featured/${wikiFeedDate()}`,
    { headers: { Accept: 'application/json' } },
  )
  if (!res.ok) throw new Error(`Wikipedia の取得に失敗しました (HTTP ${res.status})`)
  const data = asObject<WikiFeatured>(await res.json(), 'Wikipedia')
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
  // タイトル重複（tfa と mostread が同じ等）を除いて先頭 LIMIT 件。
  const seen = new Set<string>()
  return out.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true))).slice(0, LIMIT)
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
  const res = await fetchWithTimeout('https://www.jma.go.jp/bosai/quake/data/list.json', {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`地震情報の取得に失敗しました (HTTP ${res.status})`)
  const list = asArray<JmaQuake>(await res.json(), '地震情報')
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
    if (out.length >= LIMIT) break
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
  const res = await fetchWithTimeout(
    `https://api.spaceflightnewsapi.net/v4/articles/?limit=${LIMIT}`,
    {
      headers: { Accept: 'application/json' },
    },
  )
  if (!res.ok) throw new Error(`宇宙ニュースの取得に失敗しました (HTTP ${res.status})`)
  const data = asObject<SpaceResponse>(await res.json(), '宇宙ニュース')
  return (data.results ?? []).map((it) => ({
    id: `space-${it.id}`,
    title: it.title,
    url: it.url,
    author: it.news_site,
    dateMs: Date.parse(it.published_at || '') || 0,
  }))
}
