// Gmail パネル（フェーズ5の最初のスライス: 受信トレイの未読一覧のみ）。
// - この端末で未有効 or 未同意なら「Gmail を有効にする」ボタンを出す（端末ごとの任意有効化）。
// - 有効化時は union スコープ（既存 + gmail.modify）をまとめて要求し、1本のトークンに全部載せる。
// - 有効なら未読メールを一覧表示（差出人・件名・日時・スニペット）。本文表示や既読化は次スライス。

import { useMemo, useRef, useState } from 'react'
import { GMAIL_SCOPES, SCOPES } from '../../config'
import { connect, useAuth } from '../../auth/useAuth'
import { isGmailEnabled, setGmailEnabled } from './enabled'
import { useGmail } from './useGmail'
import { useMessageBody } from './useMessageBody'
import {
  IS_ANDROID,
  buildSrcDoc,
  hasBlockedImages,
  sanitizeEmailHtml,
  toIntentUrl,
} from './renderBody'
import type { GmailMessage } from './api'

// 受信時刻の短い表示（今日は時刻、それ以外は M/D）。
function formatWhen(dateMs: number): string {
  if (!dateMs) return ''
  const d = new Date(dateMs)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function GmailPanel() {
  const { grantedScopes } = useAuth()
  const hasScope = grantedScopes.includes(SCOPES.gmailModify)
  const [enabled, setEnabled] = useState(isGmailEnabled())
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = enabled && hasScope
  const { data: messages, isLoading, isError, error: queryError } = useGmail(active)

  function handleEnable() {
    setError(null)
    setConnecting(true)
    // ⚠ requestToken はこの同期フレームで走る必要がある（gisClient 実装）。
    connect(GMAIL_SCOPES)
      .then(() => {
        setGmailEnabled(true)
        setEnabled(true)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setConnecting(false))
  }

  function handleDisable() {
    setGmailEnabled(false)
    setEnabled(false)
  }

  // 未有効 or 未同意: 有効化を促す
  if (!active) {
    return (
      <div className="gmail__enable">
        <p className="panel__note">
          この端末では Gmail は表示していません。有効にすると受信トレイの未読を表示します。
        </p>
        <button
          className="btn btn--small btn--primary"
          onClick={handleEnable}
          disabled={connecting}
        >
          {connecting ? '接続中…' : 'Gmail を有効にする'}
        </button>
        {error && <p className="welcome__error">有効化に失敗しました: {error}</p>}
      </div>
    )
  }

  return (
    <div className="gmail">
      <div className="gmail__toolbar">
        {/* 切り分け用の診断表示（後で外す）: 動いているビルドの版と Android 判定。
            版が最新でなければキャッシュ問題、Android と出なければ判定が false。 */}
        <span className="gmail__diag">
          {__COMMIT_HASH__} · {IS_ANDROID ? 'Android' : 'PC'}
        </span>
        <button className="btn btn--small" onClick={handleDisable} title="この端末で Gmail を隠す">
          この端末で非表示
        </button>
      </div>
      <GmailList
        messages={messages}
        isLoading={isLoading}
        isError={isError}
        error={queryError}
        formatWhen={formatWhen}
      />
    </div>
  )
}

function GmailList({
  messages,
  isLoading,
  isError,
  error,
  formatWhen,
}: {
  messages: GmailMessage[] | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  formatWhen: (ms: number) => string
}) {
  if (isLoading) {
    return <p className="panel__note">メールを読み込み中…</p>
  }
  if (isError) {
    return <p className="panel__note panel__note--error">メールの取得に失敗しました: {String(error)}</p>
  }
  if (!messages || messages.length === 0) {
    return <p className="panel__note">未読メールはありません</p>
  }

  return (
    <ul className="gmail__list">
      {messages.map((m) => (
        <GmailRow key={m.id} m={m} formatWhen={formatWhen} />
      ))}
    </ul>
  )
}

// 1件のメール行。タップで本文プレビューを開閉する（開いたときだけ本文を取得）。
function GmailRow({ m, formatWhen }: { m: GmailMessage; formatWhen: (ms: number) => string }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="gmail__item">
      <button
        type="button"
        className="gmail__row"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="gmail__line1">
          <span className="gmail__from">{m.fromName}</span>
          <span className="gmail__when">{formatWhen(m.dateMs)}</span>
        </div>
        <div className="gmail__subject">{m.subject}</div>
        {!open && <div className="gmail__snippet">{m.snippet}</div>}
      </button>
      {open && <MessageBody id={m.id} />}
    </li>
  )
}

// 本文プレビュー本体。HTML はサニタイズして sandbox iframe に隔離表示、
// プレーンテキストのみなら <pre> にそのまま出す（HTML でないので iframe 不要）。
function MessageBody({ id }: { id: string }) {
  const { data, isLoading, isError, error } = useMessageBody(id)
  if (isLoading) return <p className="panel__note gmail__bodynote">本文を読み込み中…</p>
  if (isError)
    return (
      <p className="panel__note panel__note--error gmail__bodynote">
        本文の取得に失敗しました: {String(error)}
      </p>
    )
  if (!data) return null
  if (data.html) return <HtmlBody html={data.html} />
  if (data.text) return <pre className="gmail__text">{data.text}</pre>
  return <p className="panel__note gmail__bodynote">本文を表示できません</p>
}

// サニタイズ済みHTMLを sandbox iframe で表示。外部画像は既定でブロックし、
// 「画像を表示」で解禁する（CSP を緩めた srcdoc に差し替えて iframe を再生成）。
function HtmlBody({ html }: { html: string }) {
  const [showImages, setShowImages] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const sanitized = useMemo(() => sanitizeEmailHtml(html), [html])
  const imagesBlocked = useMemo(() => hasBlockedImages(sanitized), [sanitized])
  const srcDoc = useMemo(() => buildSrcDoc(sanitized, showImages), [sanitized, showImages])

  // iframe の中身の高さに合わせて iframe 自体の高さを調整（スクロールバー二重化を防ぐ）。
  // sandbox に allow-scripts は付けないので、中身のJSは実行されない（allow-same-origin のみ）。
  // allow-same-origin なので、隔離されていない本体側からリンククリックを横取りできる。
  function handleLoad() {
    const f = frameRef.current
    try {
      const doc = f?.contentDocument
      if (!doc) return
      f!.style.height = `${doc.body.scrollHeight + 16}px`
      // Android では、外部リンクを本体側で intent:// 起動して Chrome 本体で開く。
      // （iframe 内から直接 intent を投げると sandbox にブロックされうるため本体側で発行する）
      if (IS_ANDROID) {
        doc.addEventListener('click', handleIframeLinkClick, true)
      }
    } catch {
      // 高さ取得に失敗しても致命的ではない（既定の高さのまま）
    }
  }

  return (
    <div className="gmail__body">
      {imagesBlocked && !showImages && (
        <button
          type="button"
          className="btn btn--small gmail__imgbtn"
          onClick={() => setShowImages(true)}
        >
          画像を表示
        </button>
      )}
      {/* Android 判定が効いているかの切り分け用の目印（後で外す）。
          これが見える＝リンク横取りは有効。見えるのにリンクがアプリ内で開くなら
          intent 起動側の問題。見えない＝Android 判定が false。 */}
      {IS_ANDROID && <span className="gmail__androidmark">リンクは Chrome で開きます</span>}
      <iframe
        ref={frameRef}
        className="gmail__frame"
        title="メール本文"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
        onLoad={handleLoad}
      />
    </div>
  )
}

// iframe 内のリンククリックを本体側で受け、Android では intent:// で Chrome 本体を起動する。
function handleIframeLinkClick(e: Event): void {
  const target = e.target as Element | null
  const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!anchor) return
  const intentUrl = toIntentUrl(anchor.getAttribute('href') ?? '')
  if (!intentUrl) return // mailto: 等は既定動作に任せる
  e.preventDefault()
  // 本体(非sandbox)側に一時的な <a> を作ってクリック＝intent を発行する。
  // これで Custom Tab ではなく Chrome 本体が起動する（PWA 自体は開いたまま）。
  const launcher = document.createElement('a')
  launcher.href = intentUrl
  launcher.style.display = 'none'
  document.body.appendChild(launcher)
  launcher.click()
  document.body.removeChild(launcher)
}
