// メール本文HTMLを安全に表示するための処理（Fable 助言に基づく多層防御）。
//  1. DOMPurify でサニタイズ（危険なタグ/属性の除去）
//  2. iframe sandbox（scriptを実行させない隔離枠）に流し込む ← 表示は GmailPanel 側
//  3. iframe 内の CSP メタタグで外部画像をブロック（開封トラッキング対策）
// この3層のうち 1 と 3 のHTML組み立てをここで担う。

import DOMPurify from 'dompurify'

// メールHTMLをサニタイズする。
// - script/form/style タグ等を除去。style「属性」は iframe で隔離するので残す（表示品質のため）。
// - <a> には target="_blank" + rel を強制（PWA内でリンクを踏んで戻れなくなるのを防ぐ）。
// - src を持つ要素（<img> 等）は src を data-blocked-src に退避し、画像を既定でブロックする
//   （壊れ画像アイコンやコンソールの CSP エラーを避けつつ、CSP と二重で止める）。
export function sanitizeEmailHtml(html: string): string {
  DOMPurify.addHook('afterSanitizeAttributes', afterSanitizeAttributes)
  try {
    return DOMPurify.sanitize(html, {
      // フォームはフィッシングの温床なので丸ごと除去。style/link/meta/base も落とす。
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base'],
      // srcset も画像読み込み経路なので除去（個人利用では割り切り。復元はしない）。
      FORBID_ATTR: ['srcset'],
    })
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes')
  }
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
export function buildSrcDoc(sanitizedHtml: string, showImages: boolean): string {
  const body = showImages ? restoreImages(sanitizedHtml) : sanitizedHtml
  const imgSrc = showImages ? 'data: https:' : 'data:'
  const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:`
  const reset =
    'html,body{margin:0}' +
    "body{margin:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    'font-size:14px;line-height:1.5;color:#111;word-break:break-word;overflow-wrap:anywhere}' +
    'img{max-width:100%;height:auto}a{color:#2563eb}table{max-width:100%}'
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<style>${reset}</style></head><body>${body}</body></html>`
  )
}
