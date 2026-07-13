// Gmail API の呼び出し（フェーズ5の最初のスライス: 受信トレイの未読一覧のみ）。
// 一覧は「差出人・件名・日時・スニペット」を表示する。本文表示や既読化/アーカイブは次スライス。
//
// 実装メモ:
// - messages.list で id 一覧 → 各 id を messages.get(format=metadata) で取る N+1 構成。
//   件数を絞る（maxResults）ので個人利用では並列取得で十分。
// - スニペット・件名・差出人はプレーンテキスト（React が自動エスケープ）。本文HTMLの
//   サニタイズが要るのは本文表示スライスから。

import { fetchJson } from '../../google/fetchJson'
import { fulfilledValues, mapPool, throwIfAllRejected } from '../../google/pool'
import { decodeMimeWords } from './decodeHeader'

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

// messages.get の同時実行数の上限。最大50件を一斉に投げるとユーザー毎秒クォータに
// 触れやすいため、少数ずつ流してレート制限(429)を避ける。
const GMAIL_FETCH_CONCURRENCY = 6

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
  // From/Subject は RFC 2047 の MIME エンコードワード（=?UTF-8?B?...?= 等）で来るのが
  // 日本語メールでは普通なので、表示前に復号する（しないと件名・差出人が化ける）。
  const from = parseFrom(decodeMimeWords(headerValue(headers, 'From')))
  const subject = decodeMimeWords(headerValue(headers, 'Subject'))
  return {
    id: m.id,
    threadId: m.threadId,
    fromName: from.name,
    fromEmail: from.email,
    subject: subject || '(件名なし)',
    snippet: decodeHtmlEntities(m.snippet ?? ''),
    dateMs: m.internalDate ? Number(m.internalDate) : 0,
    unread: (m.labelIds ?? []).includes('UNREAD'),
  }
}

// 受信トレイのメールを「未読を上・既読を下」でそれぞれ新しい順に返す（ユーザー要望）。
// 未読と既読を別クエリで取り、それぞれ受信時刻の降順に並べて連結する
// （in:inbox 一括だと件数上限内で未読が既読に押し出されうるため、枠を分けて取る）。
export async function fetchInbox(maxUnread = 20, maxRead = 30): Promise<GmailMessage[]> {
  // 未読リストと既読リストを別々に取得する。既読リストの一時的な失敗（5xx 等）で
  // 受信トレイ全体を落とさないよう、既読は取れなければ空扱いにして未読だけでも表示する。
  // ただし未読（主要な表示対象）が取れない場合は、既読だけ出すと「未読0件」と誤解させる
  // 嘘の表示になるため、その理由を投げて失敗として扱う（401 等は再接続UXへ流れる）。
  const [unreadRes, readRes] = await Promise.allSettled([
    fetchMessageIds('in:inbox is:unread', maxUnread),
    fetchMessageIds('in:inbox is:read', maxRead),
  ])
  if (unreadRes.status === 'rejected') throw unreadRes.reason
  const unreadIds = unreadRes.value
  // 既読リストだけ失敗したときは、未読は出しつつ既読を空にする。黙って既読が消えると
  // 「既読メールが無い」と誤解しうるので、切り分け用にコンソールへ警告を残す。
  if (readRes.status === 'rejected') {
    console.warn('既読メール一覧の取得に失敗しました（未読のみ表示します）', readRes.reason)
  }
  const readIds = readRes.status === 'fulfilled' ? readRes.value : []
  // 未読・既読の id をまとめ、同時実行数を絞って各メタデータを取得する。
  // 1通の取得失敗（取得直後に削除されて 404 等）で受信トレイ全体を落とさないよう
  // 成功分だけ採用する。並び順は取得後に unread フラグで振り分けるので id の由来は問わない。
  const ids = [...unreadIds, ...readIds]
  const settled = await mapPool(ids, GMAIL_FETCH_CONCURRENCY, (x) => fetchMessageMeta(x.id))
  // 全件失敗（例: 401 認証切れ・403 権限不足）のときだけ、その理由を投げ直して
  // 再接続/追加同意の共通UXへ流す（部分失敗は握って成功分を表示する）。
  throwIfAllRejected(settled)
  const metas = fulfilledValues(settled)
  const desc = (a: GmailMessage, b: GmailMessage) => b.dateMs - a.dateMs
  const unread = metas.filter((m) => m.unread).sort(desc)
  const read = metas.filter((m) => !m.unread).sort(desc)
  return [...unread, ...read]
}

// ---- 本文プレビュー（本文表示スライス） ----

// base64url（Gmail の body.data は URL-safe base64）を、指定の文字コードで文字列にデコードする。
// atob は「Latin-1 のバイト列」を返すので、そのバイト列を TextDecoder で目的の charset として
// 読み直す（この2段を踏まないと日本語が化ける。ここが一番の文字化けポイント）。
// charset はパーツの Content-Type から取得（既定は UTF-8）。ISO-2022-JP・Shift_JIS・EUC-JP 等の
// 日本語メールも TextDecoder が対応する（未知/壊れた charset は UTF-8 にフォールバック）。#12
function decodeBase64Url(data: string, charset = 'utf-8'): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    // TextDecoder が知らない charset 名のときは UTF-8 で読む（化けても表示は続ける）。
    return new TextDecoder('utf-8').decode(bytes)
  }
}

// パーツの Content-Type ヘッダから charset を取り出す（例: 'text/html; charset="ISO-2022-JP"'）。
function charsetOfPart(part: MessagePart): string {
  const ct = headerValue(part.headers, 'Content-Type')
  const m = /charset\s*=\s*"?([^";]+)"?/i.exec(ct)
  return (m?.[1] ?? 'utf-8').trim().toLowerCase()
}

// payload の木を再帰的に辿り、指定 MIME タイプの最初のパーツ本文を取り出す。
function findPart(part: MessagePart | undefined, mimeType: string): string | null {
  if (!part) return null
  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBase64Url(part.body.data, charsetOfPart(part))
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

// ---- 既読化・アーカイブ（ラベル操作。gmail.modify スコープが必要） ----

// メールのラベルを付け外しする（messages.modify）。
// Gmail の「既読/未読」「受信トレイ/アーカイブ」はラベルの有無で表される:
//   - UNREAD ラベルあり=未読、外す=既読
//   - INBOX ラベルあり=受信トレイ、外す=アーカイブ（メール自体は消えない）
async function modifyMessage(
  id: string,
  addLabelIds: string[],
  removeLabelIds: string[],
): Promise<void> {
  await fetchJson<unknown>(`${GMAIL_BASE}/messages/${id}/modify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  })
}

// 既読にする（UNREAD を外す）。Undo は markMessageUnread。
export function markMessageRead(id: string): Promise<void> {
  return modifyMessage(id, [], ['UNREAD'])
}
// 未読に戻す（UNREAD を付け直す＝既読化の Undo）。
export function markMessageUnread(id: string): Promise<void> {
  return modifyMessage(id, ['UNREAD'], [])
}
// アーカイブする（INBOX を外す＝受信トレイから外す）。Undo は unarchiveMessage。
export function archiveMessage(id: string): Promise<void> {
  return modifyMessage(id, [], ['INBOX'])
}
// アーカイブを取り消す（INBOX を付け直す＝受信トレイに戻す）。
export function unarchiveMessage(id: string): Promise<void> {
  return modifyMessage(id, ['INBOX'], [])
}
