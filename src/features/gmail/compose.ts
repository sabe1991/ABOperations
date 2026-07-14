// Gmail の送信（新規作成・返信）（#4）。
// messages.send に RFC 2822 形式の MIME メッセージを base64url で渡す。
// gmail.modify スコープに送信権限が含まれるため、追加同意は不要。
//
// 文字コードの扱い（日本語メール対策）:
// - 本文は text/plain; charset=UTF-8 を base64 で送る（生 UTF-8 直書きの行長・改行事故を避ける）。
// - 件名など非 ASCII を含むヘッダは RFC 2047 のエンコードワード =?UTF-8?B?..?= にする。
//   これにより MIME 全体が ASCII になり、btoa で base64url 化できる。

import { fetchJson } from '../../google/fetchJson'
import { decodeMimeWords } from './decodeHeader'

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

// 送信するメッセージ（画面のフォームから受け取る）。
export interface OutgoingMessage {
  to: string
  cc?: string
  subject: string
  body: string // プレーンテキスト
  // 返信時のみ: スレッドと参照ヘッダ（会話にぶら下げるために使う）。
  threadId?: string
  inReplyTo?: string // 元メールの Message-ID
  references?: string // 元メールの References（無ければ Message-ID を入れる）
}

// UTF-8 文字列を標準 base64 に変換する（バイト単位で atob/btoa の Latin-1 制約を回避）。
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

// ヘッダ値から CR/LF を除去する（ヘッダ注入対策）。宛先・件名に改行が紛れても
// 意図しない追加ヘッダ（Bcc 等）を構文的に作れないようにする。
function stripCrlf(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

// ヘッダ値に非 ASCII が含まれるなら RFC 2047 エンコードワードにする（件名の日本語対策）。
// メールアドレス（ASCII）はそのまま通る。
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(value)) return value
  return `=?UTF-8?B?${utf8ToBase64(value)}?=`
}

// アドレスリスト（カンマ区切り）をヘッダに載る形へ整える。
// 「表示名 <addr@example.com>」の表示名に日本語が含まれても btoa で落ちないよう、
// 表示名だけを RFC 2047 エンコードし、アドレス本体（ASCII）はそのまま残す。
function encodeAddressList(list: string): string {
  return list
    .split(',')
    .map((raw) => stripCrlf(raw).trim())
    .filter(Boolean)
    .map((addr) => {
      const m = /^(.*?)\s*<([^>]+)>$/.exec(addr)
      if (m) {
        const name = m[1].replace(/^"|"$/g, '').trim()
        return name ? `${encodeHeaderValue(name)} <${m[2].trim()}>` : m[2].trim()
      }
      return addr
    })
    .join(', ')
}

// base64 を 76 文字ごとに改行する（RFC 2045 の行長制限。長い本文で送信が弾かれるのを防ぐ）。
function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, '$&\r\n').trimEnd()
}

// 標準 base64 を base64url（URL セーフ）に変換する。messages.send の raw はこの形式。
function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// OutgoingMessage を RFC 2822 の MIME 文字列に組み立てる。全行 CRLF。
function buildMime(msg: OutgoingMessage): string {
  const headers: string[] = []
  headers.push(`To: ${encodeAddressList(msg.to)}`)
  if (msg.cc?.trim()) headers.push(`Cc: ${encodeAddressList(msg.cc)}`)
  headers.push(`Subject: ${encodeHeaderValue(stripCrlf(msg.subject))}`)
  if (msg.inReplyTo) headers.push(`In-Reply-To: ${msg.inReplyTo}`)
  if (msg.references) headers.push(`References: ${msg.references}`)
  headers.push('MIME-Version: 1.0')
  headers.push('Content-Type: text/plain; charset="UTF-8"')
  headers.push('Content-Transfer-Encoding: base64')
  const bodyB64 = wrap76(utf8ToBase64(msg.body))
  return `${headers.join('\r\n')}\r\n\r\n${bodyB64}`
}

// メールを送信する。返信のときは threadId を添えて同じ会話にぶら下げる。
export async function sendMessage(msg: OutgoingMessage): Promise<void> {
  const raw = toBase64Url(btoa(buildMime(msg)))
  const body: { raw: string; threadId?: string } = { raw }
  if (msg.threadId) body.threadId = msg.threadId
  await fetchJson<unknown>(`${GMAIL_BASE}/messages/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// 返信に必要な元メールのメタ情報を取得する（#4）:
//  - inReplyTo: 元の Message-ID（In-Reply-To ヘッダに入れる）
//  - references: 元の References + 元の Message-ID（スレッド化に使う）
//  - replyToAddress: Reply-To 指定があればその宛先（無ければ空。呼び出し側で From にフォールバック）
//  - subject: 元の生の件名（表示用プレースホルダを含まない。Re: を付ける土台にする）
export interface ReplyRefs {
  inReplyTo: string
  references: string
  replyToAddress: string
  subject: string
}

// "表示名 <addr@example.com>" または "addr@example.com" からアドレス部分だけを取り出す。
function extractAddress(raw: string): string {
  const m = /<([^>]+)>/.exec(raw)
  return (m ? m[1] : raw).trim()
}

export async function fetchReplyRefs(messageId: string): Promise<ReplyRefs> {
  const params = new URLSearchParams({ format: 'metadata' })
  params.append('metadataHeaders', 'Message-ID')
  params.append('metadataHeaders', 'References')
  params.append('metadataHeaders', 'Reply-To')
  params.append('metadataHeaders', 'Subject')
  const m = await fetchJson<{ payload?: { headers?: { name: string; value: string }[] } }>(
    `${GMAIL_BASE}/messages/${messageId}?${params.toString()}`,
  )
  const headers = m.payload?.headers ?? []
  const get = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
  const msgId = get('Message-ID')
  const prevRefs = get('References')
  const replyTo = get('Reply-To')
  return {
    inReplyTo: msgId,
    references: [prevRefs, msgId].filter(Boolean).join(' '),
    replyToAddress: replyTo ? extractAddress(replyTo) : '',
    // 生ヘッダは RFC 2047 エンコードのことがあるので復号して素の件名にする。
    subject: decodeMimeWords(get('Subject')),
  }
}

// 件名に「Re: 」を付ける（既に付いていれば二重に付けない）。
export function replySubject(subject: string): string {
  return /^\s*re:/i.test(subject) ? subject : `Re: ${subject}`
}

// 返信本文の下書き（元メールを引用符「> 」付きで引用する）。
export function quoteBody(fromName: string, dateMs: number, original: string): string {
  const when = dateMs ? new Date(dateMs).toLocaleString('ja-JP') : ''
  const quoted = original
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  return `\n\n${when} ${fromName} さんは書きました:\n${quoted}`
}
