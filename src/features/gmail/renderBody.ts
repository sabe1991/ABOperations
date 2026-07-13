// メール本文HTMLを安全に表示するための処理（Fable 助言に基づく多層防御）。
//  1. DOMPurify でサニタイズ（危険なタグ/属性の除去）
//  2. iframe sandbox（scriptを実行させない隔離枠）に流し込む ← 表示は GmailPanel 側
//  3. iframe 内の CSP メタタグで外部画像をブロック（開封トラッキング対策）
// この3層のうち 1 と 3 のHTML組み立てをここで担う。

import DOMPurify from 'dompurify'

// Android かどうか。Android では PWA 本体(スタンドアロン)のとき外部リンクが既定で
// Custom Tab(アプリ内 Chrome)に流れるため、intent:// に変換して Chrome 本体で開かせる。
// ※ WebAPK では display-mode: standalone が期待どおり返らないことがあるため、
//   スタンドアロン判定はやめて「Android なら適用」に広げた（通常タブでも intent は
//   Chrome を開くだけで害がない）。Mac/PC では false。
export const IS_ANDROID: boolean = (() => {
  try {
    return /Android/i.test(navigator.userAgent)
  } catch {
    return false
  }
})()

// https/http のURLを Android の intent URI に変換する（Chrome 本体で開かせるため）。
// - `package=com.android.chrome` で開き先を Chrome 本体に固定（Custom Tab 回避の要）。
// - `S.browser_fallback_url` に元URLを入れ、Chrome 未解決時は通常遷移にフォールバック。
// - intent 側の "#Intent;...;end" と衝突するため URL のフラグメント(#以降)は落とす
//   （メール内リンクでの利用は稀）。http/https 以外(mailto: など)は変換せず null を返す。
export function toIntentUrl(href: string): string | null {
  try {
    const u = new URL(href)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const scheme = u.protocol.slice(0, -1) // "https" / "http"
    const hostPath = `${u.host}${u.pathname}${u.search}`
    const fallback = encodeURIComponent(href)
    return (
      `intent://${hostPath}#Intent;scheme=${scheme};action=android.intent.action.VIEW;` +
      `package=com.android.chrome;S.browser_fallback_url=${fallback};end`
    )
  } catch {
    return null
  }
}

// メールHTMLをサニタイズする。
// - script/form/style タグ等を除去。style「属性」は iframe で隔離するので残す（表示品質のため）。
// - <a> には target="_blank" + rel を強制（PWA内でリンクを踏んで戻れなくなるのを防ぐ）。
// - src を持つ要素（<img> 等）は src を data-blocked-src に退避し、画像を既定でブロックする
//   （壊れ画像アイコンやコンソールの CSP エラーを避けつつ、CSP と二重で止める）。
// - 最後に、<a> で囲まれていない生の URL を自動でリンク化する（HTMLメールでも URL が
//   ただの文字列で押せないことがあるため・ユーザー要望）。
export function sanitizeEmailHtml(html: string): string {
  DOMPurify.addHook('afterSanitizeAttributes', afterSanitizeAttributes)
  try {
    const sanitized = DOMPurify.sanitize(html, {
      // フォームはフィッシングの温床なので丸ごと除去。style/link/meta/base も落とす。
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base'],
      // srcset も画像読み込み経路なので除去（個人利用では割り切り。復元はしない）。
      FORBID_ATTR: ['srcset'],
    })
    return linkifyBareUrls(sanitized)
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes')
  }
}

// URL 1個ぶんのトークン。href が null ならただのテキスト、非 null ならリンク。
export interface LinkToken {
  text: string
  href: string | null
}

// テキストを「URL部分」と「それ以外」に分割する。プレーンテキスト本文のリンク化にも使う。
// http(s):// または www. で始まる連続文字を URL とみなし、末尾の句読点・閉じ括弧は URL に含めない。
export function tokenizeLinks(input: string): LinkToken[] {
  const tokens: LinkToken[] = []
  // URL に使う ASCII 文字だけを本体とみなす（日本語の句読点や全角文字は URL に含めない）。
  const re = /(?:https?:\/\/|www\.)[A-Za-z0-9\-._~:/?#@!$&*+,;=%]+/gi
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    let url = m[0]
    // 文末の「. , ; : ! ?」は URL ではなく後続テキスト扱いにする。
    const trailMatch = url.match(/[.,;:!?]+$/)
    const trail = trailMatch ? trailMatch[0] : ''
    if (trail) url = url.slice(0, url.length - trail.length)
    const start = m.index
    if (start > last) tokens.push({ text: input.slice(last, start), href: null })
    const href = /^www\./i.test(url) ? `https://${url}` : url
    tokens.push({ text: url, href })
    if (trail) tokens.push({ text: trail, href: null })
    last = start + m[0].length
  }
  if (last < input.length) tokens.push({ text: input.slice(last), href: null })
  return tokens
}

// サニタイズ済みHTML内の、<a> に囲まれていない生 URL をリンク化する。
// DOMParser の不活性ドキュメント上でテキストノードを走査し、URL部分だけ <a> に置き換える。
function linkifyBareUrls(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode()) !== null) textNodes.push(node as Text)
  for (const t of textNodes) {
    // 既にリンク内、または <style>/<script> 内のテキストは触らない。
    if (t.parentElement?.closest('a, style, script')) continue
    const value = t.nodeValue ?? ''
    if (!/(?:https?:\/\/|www\.)/i.test(value)) continue
    const tokens = tokenizeLinks(value)
    if (!tokens.some((tk) => tk.href)) continue
    const frag = doc.createDocumentFragment()
    for (const tk of tokens) {
      if (tk.href) {
        const a = doc.createElement('a')
        a.setAttribute('href', tk.href)
        a.setAttribute('target', '_blank')
        a.setAttribute('rel', 'noopener noreferrer')
        a.textContent = tk.text
        frag.appendChild(a)
      } else {
        frag.appendChild(doc.createTextNode(tk.text))
      }
    }
    t.parentNode?.replaceChild(frag, t)
  }
  return doc.body.innerHTML
}

function afterSanitizeAttributes(node: Element): void {
  // リンクは新規タブで開き、参照元(Referer)やwindow.openerを渡さない。
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
  // 画像などの src を退避してブロック（後で「画像を表示」で戻す）。
  if (node.hasAttribute('src')) {
    const src = node.getAttribute('src') ?? ''
    node.removeAttribute('src')
    node.setAttribute('data-blocked-src', src)
  }
}

// サニタイズ済みHTMLにブロックした画像が含まれるか（「画像を表示」ボタンの出し分け用）。
export function hasBlockedImages(sanitized: string): boolean {
  return (
    sanitized.includes('data-blocked-src') ||
    /background(-image)?\s*:\s*url\(/i.test(sanitized)
  )
}

// 退避した data-blocked-src を src に戻す（「画像を表示」時）。DOMParser 経由で安全に置換。
function restoreImages(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('[data-blocked-src]').forEach((el) => {
    const src = el.getAttribute('data-blocked-src') ?? ''
    el.removeAttribute('data-blocked-src')
    if (src) el.setAttribute('src', src)
  })
  return doc.body.innerHTML
}

// iframe の srcdoc に流し込む完全なHTML文書を組み立てる。
// CSP メタタグで、既定は data: 画像のみ許可（＝外部画像ブロック）、
// showImages 時のみ https: 画像も許可する。default-src 'none' で script/fetch 等は全遮断。
export function buildSrcDoc(sanitizedHtml: string, showImages: boolean, dark = false): string {
  const body = showImages ? restoreImages(sanitizedHtml) : sanitizedHtml
  const imgSrc = showImages ? 'data: https:' : 'data:'
  const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:`
  // ダーク時は本文カードの地を純白ではなく穏やかな暖色オフホワイトにして眩しさを抑える（#27）。
  // 本文色は #111 のままなのでコントラストは十分保たれる（メールHTMLの互換のため全反転はしない）。
  const bg = dark ? '#e7e0d3' : '#ffffff'
  const reset =
    'html,body{margin:0}' +
    `body{margin:8px;background:${bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;` +
    'font-size:14px;line-height:1.5;color:#111;word-break:break-word;overflow-wrap:anywhere}' +
    'img{max-width:100%;height:auto}a{color:#2563eb}table{max-width:100%}'
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<style>${reset}</style></head><body>${body}</body></html>`
  )
}
