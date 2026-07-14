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
  filename?: string
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

// base64url（Gmail の body.data は URL-safe base64）を生のバイト列に戻す。
// atob は「Latin-1 のバイト列」を文字列で返すので、各文字コードを Uint8Array に写す。
// Gmail はパディング（=）を落として返すことがあるため、atob 前に補う（末尾の欠けを防ぐ）。
function base64UrlToBytes(data: string): Uint8Array {
  let b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4
  if (pad) b64 += '='.repeat(4 - pad)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// ISO-2022-JP 系のエスケープ（ESC $ / ESC (）が生バイトにあるか。charset 宣言が欠落/誤りでも
// これで日本語メールの ISO-2022-JP を検出できる（メールの Content-Type は当てにならないことが多い）。
function hasIso2022Escape(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0x1b && (bytes[i + 1] === 0x24 || bytes[i + 1] === 0x28)) return true
  }
  return false
}

// デコード結果の「もっともらしさ」（小さいほど良い）。文字化け U+FFFD の個数を数え、
// ISO-2022-JP のエスケープが文字列に残っていれば大きく減点する（＝誤った charset で復号した証拠）。
function decodeScore(text: string): number {
  let n = 0
  for (const ch of text) {
    // 文字化け(U+FFFD)は最も重い証拠。半角カナ(U+FF61-FF9F)は EUC-JP を Shift_JIS で
    // 誤読したときに大量発生する兆候なので軽く加点し、正しい EUC-JP 側が選ばれるようにする。
    if (ch === '�') n += 2
    else if (ch >= '\uff61' && ch <= '\uff9f') n += 1
  }
  if (/\u001b[$(]/.test(text)) n += 1000 // 残った ESC$/ESC( ＝ ISO-2022-JP 誤読
  return n
}

// メール本文の生バイトを、宣言 charset をヒントにしつつ「最も化けない」charset で文字列化する（#12）。
// 日本語メール（Shift_JIS / EUC-JP / ISO-2022-JP）は charset 宣言が欠落・誤記のことが多く、UTF-8 固定
// 復号だと日本語が全て文字化けする（本文が ◆◆◆ 等になる）。候補を順に試し、文字化けが最少のものを採る。
function decodeBody(bytes: Uint8Array, declaredCharset?: string): string {
  const candidates: string[] = []
  // ISO-2022-JP はエスケープ検出で最優先（UTF-8 でも化けずに“通って”しまい見分けにくいため）。
  if (hasIso2022Escape(bytes)) candidates.push('iso-2022-jp')
  // UTF-8 を宣言 charset より先に試す（Fable 助言）。UTF-8 の検証は厳格で、実体が Shift_JIS/EUC-JP
  // のバイト列はほぼ必ず文字化け(U+FFFD)を出す＝スコアが悪化するため、UTF-8 が 0 点で通るのは
  // 「本当に UTF-8 のとき」だけ。逆に「実体 UTF-8 なのに charset=shift_jis と誤宣言」されたメールで、
  // 誤った宣言を先に採って化けさせる事故を防げる。
  candidates.push('utf-8')
  if (declaredCharset) candidates.push(declaredCharset)
  candidates.push('shift_jis', 'euc-jp', 'iso-2022-jp')
  const seen = new Set<string>()
  let best: string | null = null
  let bestScore = Infinity
  for (const raw of candidates) {
    const cs = raw.toLowerCase()
    if (seen.has(cs)) continue
    seen.add(cs)
    let text: string
    try {
      text = new TextDecoder(cs).decode(bytes)
    } catch {
      continue // TextDecoder が知らない charset 名は飛ばす
    }
    const s = decodeScore(text)
    if (s < bestScore) {
      best = text
      bestScore = s
      if (s === 0) break // 文字化け無し＝確定
    }
  }
  return best ?? new TextDecoder('utf-8').decode(bytes)
}

// パーツの Content-Type ヘッダから charset を取り出す（例: 'text/html; charset="ISO-2022-JP"'）。
// 宣言が無ければ undefined（decodeBody 側で候補から自動判定する）。
function charsetOfPart(part: MessagePart): string | undefined {
  const ct = headerValue(part.headers, 'Content-Type')
  const m = /charset\s*=\s*"?([^";]+)"?/i.exec(ct)
  return m?.[1]?.trim().toLowerCase()
}

// payload の木を再帰的に辿り、指定 MIME タイプの最初のパーツ本文を取り出す。
function findPart(part: MessagePart | undefined, mimeType: string): string | null {
  if (!part) return null
  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBody(base64UrlToBytes(part.body.data), charsetOfPart(part))
  }
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType)
    if (found != null) return found
  }
  return null
}

// 取り出した本文。html があれば html を、無ければ plain（プレーンテキスト）を使う。
// attachments は添付ファイル（PDF・画像等）の一覧（#13）。実体は都度 fetchAttachmentBytes で取得する。
export interface MessageBody {
  html: string | null
  text: string | null
  attachments: Attachment[]
}

// 添付ファイル1件のメタ情報（#13）。実データは attachmentId で attachments.get から取る。
export interface Attachment {
  attachmentId: string
  filename: string
  mimeType: string
  size: number // バイト数（表示用の目安。0 のこともある）
}

// MIME タイプから代替のファイル名を作る（filename ヘッダが無い添付・#13）。
function fallbackAttachmentName(mimeType: string | undefined): string {
  const ext = (mimeType ?? '').split('/')[1]?.split(';')[0]?.trim() || 'bin'
  return `添付ファイル.${ext}`
}

// payload を再帰的に辿り、添付ファイル（attachmentId を持ち、本文にインライン表示されないパーツ）を集める（#13）。
// 除外するのは「本文に埋め込まれるインライン部品」だけ:
//   - Content-Disposition: inline のパーツ（署名ロゴ等・#11 で本文内に表示済み）
//   - Disposition 宣言が無く Content-ID を持つパーツ（cid: 参照される旧来のインライン画像）
// 逆に Content-Disposition: attachment のものは Content-ID があっても添付として一覧する
// （Outlook 等は通常添付にも Content-ID を付けるため、cid だけで除外すると添付が消える）。
// 本文テキスト/HTML 部は attachmentId を持たないので自然に対象外になる。
function collectAttachments(part: MessagePart | undefined, acc: Attachment[]): void {
  if (!part) return
  const attachmentId = part.body?.attachmentId
  if (attachmentId) {
    const disposition = headerValue(part.headers, 'Content-Disposition').toLowerCase()
    const hasCid = Boolean(headerValue(part.headers, 'Content-ID'))
    const isInline = disposition.startsWith('inline') || (!disposition && hasCid)
    // filename も disposition も無い（＝添付と断定できない）パーツは拾わない（本文断片の誤検出防止）。
    const looksLikeAttachment = Boolean(part.filename) || disposition.startsWith('attachment')
    if (!isInline && looksLikeAttachment) {
      acc.push({
        attachmentId,
        filename: part.filename || fallbackAttachmentName(part.mimeType),
        mimeType: part.mimeType ?? 'application/octet-stream',
        size: part.body?.size ?? 0,
      })
    }
  }
  for (const child of part.parts ?? []) collectAttachments(child, acc)
}

// 添付ファイルの実データ（生バイト列）を取得する（#13）。ダウンロード時に呼ぶ。
export async function fetchAttachmentBytes(
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array> {
  const res = await fetchJson<{ data?: string }>(
    `${GMAIL_BASE}/messages/${messageId}/attachments/${attachmentId}`,
  )
  return base64UrlToBytes(res.data ?? '')
}

// ---- インライン画像（cid:）対応（#11） ----
// HTMLメールは埋め込み画像を <img src="cid:XXX"> で参照し、実体は Content-ID: <XXX> を持つ
// 画像パーツとして同梱される（メール署名のロゴなど）。これを attachments.get で取得して
// data: URI（画像バイトを本文に埋め込んだURL）に変換し、本文HTMLの cid: 参照を差し替える。
// data: 画像は自己完結で外部通信を伴わない（＝開封トラッキングの心配が無い）ため、
// 外部画像ブロック（既定で画像を止める仕組み）の対象外として既定で表示してよい。

// 1メールあたりに取り込むインライン画像の上限。悪意ある/巨大なメールで大量取得しないための保険。
const MAX_INLINE_IMAGES = 20

interface InlineImage {
  cid: string // Content-ID（山括弧 < > を除いたもの）
  attachmentId: string
  mimeType: string
}

// payload を再帰的に辿り、Content-ID を持つ画像パーツ（＝インライン画像）を集める。
function collectInlineImages(part: MessagePart | undefined, acc: InlineImage[]): void {
  if (!part) return
  const cidRaw = headerValue(part.headers, 'Content-ID')
  const attachmentId = part.body?.attachmentId
  const mime = (part.mimeType ?? '').toLowerCase()
  if (cidRaw && attachmentId && mime.startsWith('image/')) {
    acc.push({ cid: cidRaw.replace(/^<|>$/g, '').trim(), attachmentId, mimeType: part.mimeType as string })
  }
  for (const child of part.parts ?? []) collectInlineImages(child, acc)
}

// 添付データ（base64url）を取得し、data: URI に変換する。取得できなければ空文字。
async function fetchInlineDataUri(messageId: string, img: InlineImage): Promise<string> {
  const res = await fetchJson<{ data?: string }>(
    `${GMAIL_BASE}/messages/${messageId}/attachments/${img.attachmentId}`,
  )
  const data = res.data ?? ''
  if (!data) return ''
  // data: URI は標準 base64（+ /）を使うので、Gmail の base64url（- _）から戻す。
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  return `data:${img.mimeType};base64,${b64}`
}

function decodeUriSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// 本文HTML内の cid: 参照（<img src> と style の background url()）を data: URI に置き換える。
// DOMParser の不活性ドキュメント上で属性を書き換えるので、文字列 replace より壊れにくい。
function replaceCidReferences(html: string, cidMap: Map<string, string>): string {
  if (cidMap.size === 0) return html
  const lookup = (id: string): string | undefined => {
    const key = id.replace(/^<|>$/g, '').trim()
    return cidMap.get(key) ?? cidMap.get(decodeUriSafe(key))
  }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('[src]').forEach((el) => {
    const m = /^\s*cid:(.+)$/i.exec(el.getAttribute('src') ?? '')
    if (!m) return
    const uri = lookup(m[1])
    if (uri) el.setAttribute('src', uri)
  })
  doc.querySelectorAll('[style]').forEach((el) => {
    const style = el.getAttribute('style') ?? ''
    if (!/url\(\s*['"]?cid:/i.test(style)) return
    el.setAttribute(
      'style',
      style.replace(/url\(\s*['"]?cid:([^'")]+)['"]?\s*\)/gi, (whole, id) => {
        const uri = lookup(id)
        return uri ? `url("${uri}")` : whole
      }),
    )
  })
  return doc.body.innerHTML
}

// 1通の本文を取得する（format=full で全パーツを取得し、text/html 優先で抜き出す）。
export async function fetchMessageBody(id: string): Promise<MessageBody> {
  const params = new URLSearchParams({ format: 'full' })
  const m = await fetchJson<MessageResponse>(`${GMAIL_BASE}/messages/${id}?${params.toString()}`)
  let html = findPart(m.payload, 'text/html')
  // HTML本文がある場合だけ、埋め込み画像(cid:)を data: URI に差し替える（#11）。
  if (html) {
    const inline: InlineImage[] = []
    collectInlineImages(m.payload, inline)
    const targets = inline.slice(0, MAX_INLINE_IMAGES)
    if (targets.length > 0) {
      const cidMap = new Map<string, string>()
      // 個別取得の失敗は握る（その画像は cid: のまま残り、外部画像扱いでブロックされるだけ）。
      const settled = await mapPool(targets, GMAIL_FETCH_CONCURRENCY, (img) =>
        fetchInlineDataUri(id, img),
      )
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) cidMap.set(targets[i].cid, r.value)
      })
      html = replaceCidReferences(html, cidMap)
    }
  }
  const attachments: Attachment[] = []
  collectAttachments(m.payload, attachments)
  return {
    html,
    text: findPart(m.payload, 'text/plain'),
    attachments,
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
