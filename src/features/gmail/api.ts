// Gmail API の呼び出し（フェーズ5の最初のスライス: 受信トレイの未読一覧のみ）。
// 一覧は「差出人・件名・日時・スニペット」を表示する。本文表示や既読化/アーカイブは次スライス。
//
// 実装メモ:
// - messages.list で id 一覧 → 各 id を messages.get(format=metadata) で取る N+1 構成。
//   件数を絞る（maxResults）ので個人利用では並列取得で十分。
// - スニペット・件名・差出人はプレーンテキスト（React が自動エスケープ）。本文HTMLの
//   サニタイズが要るのは本文表示スライスから。

import { fetchJson } from '../../google/fetchJson'

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

interface ListResponse {
  messages?: { id: string; threadId: string }[]
  resultSizeEstimate?: number
}

// メール本文の1パーツ（multipart の枝）。part は入れ子になりうる。
interface MessagePart {
  mimeType?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; size?: number; attachmentId?: string }
  parts?: MessagePart[]
}

interface MessageResponse {
  id: string
  threadId: string
  snippet?: string
  labelIds?: string[]
  internalDate?: string // 受信時刻（エポックミリ秒の文字列）
  payload?: MessagePart & { headers?: { name: string; value: string }[] }
}

export interface GmailMessage {
  id: string
  threadId: string
  fromName: string
  fromEmail: string
  subject: string
  snippet: string
  dateMs: number
  unread: boolean
}

function headerValue(headers: { name: string; value: string }[] | undefined, name: string): string {
  const h = headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())
  return h?.value ?? ''
}

// Gmail の snippet は HTML エスケープ済み（&#39; &amp; 等の文字参照を含む）。
// テキストとして描画する前にデコードして、記号がそのまま見えないようにする（Fable 助言）。
// デコード後もテキスト（{文字列}）として描画するので二重解釈（XSS）は起きない。
function decodeHtmlEntities(s: string): string {
  if (!s) return s
  try {
    const doc = new DOMParser().parseFromString(s, 'text/html')
    return doc.documentElement.textContent ?? s
  } catch {
    return s
  }
}

// From ヘッダ（"表示名 <addr@example.com>" または "addr@example.com"）を分解する。
function parseFrom(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (m) {
    const name = m[1].replace(/^"|"$/g, '').trim()
    return { name: name || m[2], email: m[2] }
  }
  const v = raw.trim()
  return { name: v, email: v }
}

async function fetchMessageIds(q: string, maxResults: number): Promise<{ id: string }[]> {
  const params = new URLSearchParams({ q, maxResults: String(maxResults) })
  const res = await fetchJson<ListResponse>(`${GMAIL_BASE}/messages?${params.toString()}`)
  return res.messages ?? []
}

async function fetchMessageMeta(id: string): Promise<GmailMessage> {
  const params = new URLSearchParams({ format: 'metadata' })
  // 必要なヘッダだけ取得（本文は取らない＝軽量・安全）
  params.append('metadataHeaders', 'From')
  params.append('metadataHeaders', 'Subject')
  params.append('metadataHeaders', 'Date')
  const m = await fetchJson<MessageResponse>(`${GMAIL_BASE}/messages/${id}?${params.toString()}`)
  const headers = m.payload?.headers
  const from = parseFrom(headerValue(headers, 'From'))
  return {
    id: m.id,
    threadId: m.threadId,
    fromName: from.name,
    fromEmail: from.email,
    subject: headerValue(headers, 'Subject') || '(件名なし)',
    snippet: decodeHtmlEntities(m.snippet ?? ''),
    dateMs: m.internalDate ? Number(m.internalDate) : 0,
    unread: (m.labelIds ?? []).includes('UNREAD'),
  }
}

// 受信トレイの未読メールを新しい順で返す。
export async function fetchInboxUnread(maxResults = 20): Promise<GmailMessage[]> {
  const ids = await fetchMessageIds('in:inbox is:unread', maxResults)
  const msgs = await Promise.all(ids.map((x) => fetchMessageMeta(x.id)))
  return msgs.sort((a, b) => b.dateMs - a.dateMs)
}

// ---- 本文プレビュー（本文表示スライス） ----

// base64url（Gmail の body.data は URL-safe base64）を UTF-8 文字列にデコードする。
// atob は「Latin-1 のバイト列」を返すので、そのバイト列を TextDecoder で UTF-8 として
// 読み直す（この2段を踏まないと日本語が化ける。ここが一番の文字化けポイント）。
// 文字コードは実用上 UTF-8 決め打ち。ISO-2022-JP 等は後で対応（TODO）。
function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

// payload の木を再帰的に辿り、指定 MIME タイプの最初のパーツ本文を取り出す。
function findPart(part: MessagePart | undefined, mimeType: string): string | null {
  if (!part) return null
  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBase64Url(part.body.data)
  }
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType)
    if (found != null) return found
  }
  return null
}

// 取り出した本文。html があれば html を、無ければ plain（プレーンテキスト）を使う。
export interface MessageBody {
  html: string | null
  text: string | null
}

// 1通の本文を取得する（format=full で全パーツを取得し、text/html 優先で抜き出す）。
export async function fetchMessageBody(id: string): Promise<MessageBody> {
  const params = new URLSearchParams({ format: 'full' })
  const m = await fetchJson<MessageResponse>(`${GMAIL_BASE}/messages/${id}?${params.toString()}`)
  return {
    html: findPart(m.payload, 'text/html'),
    text: findPart(m.payload, 'text/plain'),
  }
}
