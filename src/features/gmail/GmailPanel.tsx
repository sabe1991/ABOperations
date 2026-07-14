// Gmail パネル（フェーズ5）。
// - この端末で未有効 or 未同意なら「Gmail を有効にする」ボタンを出す（端末ごとの任意有効化）。
// - 有効化時は union スコープ（既存 + gmail.modify）をまとめて要求し、1本のトークンに全部載せる。
// - 有効なら未読メールを一覧表示（差出人・件名・日時・スニペット）。タップで本文プレビュー、
//   各メールを既読化・アーカイブでき、いずれも「元に戻す」で取り消せる。

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GMAIL_SCOPES, SCOPES } from '../../config'
import { connect, useAuth } from '../../auth/useAuth'
import { setGmailEnabled, useGmailEnabled } from './enabled'
import { useGmail } from './useGmail'
import { useMessageBody } from './useMessageBody'
import { useArchive, useMarkRead, useMarkUnread, useUnarchive } from './useGmailMutations'
import { useSendMessage } from './useSendMessage'
import { fetchReplyRefs, quoteBody, replySubject } from './compose'
import type { OutgoingMessage } from './compose'
import {
  IS_ANDROID,
  buildSrcDoc,
  hasBlockedImages,
  sanitizeEmailHtml,
  tokenizeLinks,
  toIntentUrl,
} from './renderBody'
import { fetchAttachmentBytes } from './api'
import type { Attachment, GmailMessage } from './api'
import { AuthError } from '../../google/fetchJson'
import { markExpired } from '../../auth/authStore'
import { useEffectiveDark } from '../settings/displayPrefs'
import { ListSkeleton } from '../../Skeleton'
import { PanelError } from '../../ErrorBoundary'
import { toUserMessage } from '../../errorMessage'
import { useDialog } from '../../useDialog'

// スナックバー1件分。直近1件のみ・Query キャッシュ外のローカル state。
// undo が null のとき（送信完了の通知など）は「元に戻す」ボタンを出さない。
type Snack = { text: string; undo: (() => void) | null }

// 作成シートの状態: 新規作成 / 返信（元メール付き） / 閉じている（null）。
type ComposeState = { mode: 'new' } | { mode: 'reply'; message: GmailMessage } | null

// バイト数を読みやすい単位にする（添付ファイルサイズ表示・#13）。
function formatBytes(n: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

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
  const enabled = useGmailEnabled()
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = enabled && hasScope
  const { data: messages, isLoading, isError, error: queryError, refetch } = useGmail(active)

  // スナックバー（既読化/アーカイブの Undo・送信完了の通知）。行が消えても残るよう親で管理する。
  const [snack, setSnack] = useState<Snack | null>(null)
  const snackTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(snackTimer.current), [])
  function notify(text: string, undo: (() => void) | null) {
    window.clearTimeout(snackTimer.current)
    setSnack({ text, undo })
    snackTimer.current = window.setTimeout(() => setSnack(null), 5000)
  }
  function handleSnackUndo() {
    if (snack?.undo) snack.undo()
    window.clearTimeout(snackTimer.current)
    setSnack(null)
  }

  // 既読化・アーカイブのミューテーションは、行ごとに作らず親でまとめて1組だけ持つ（#45）。
  // 行が消えても Undo を出し続けられるよう、通知（notify）とセットにしてここで定義する。
  const markRead = useMarkRead()
  const markUnread = useMarkUnread()
  const archive = useArchive()
  const unarchive = useUnarchive()
  function handleMarkRead(m: GmailMessage) {
    markRead.mutate(m)
    notify('既読にしました', () => markUnread.mutate(m))
  }
  function handleMarkUnread(m: GmailMessage) {
    markUnread.mutate(m)
    notify('未読にしました', () => markRead.mutate(m))
  }
  function handleArchive(m: GmailMessage) {
    archive.mutate(m)
    notify('アーカイブしました', () => unarchive.mutate(m))
  }

  // 選択中のメール（本文モーダルで開く）。null なら閉じている。
  const [selected, setSelected] = useState<GmailMessage | null>(null)

  // 作成シート（新規作成・返信）と送信ミューテーション（#4）。
  const [compose, setCompose] = useState<ComposeState>(null)
  const [composeError, setComposeError] = useState<string | null>(null)
  const send = useSendMessage()
  function openCompose(state: ComposeState) {
    setComposeError(null)
    setCompose(state)
  }
  function handleSend(msg: OutgoingMessage) {
    setComposeError(null)
    send.mutate(msg, {
      onSuccess: () => {
        setCompose(null)
        notify('メールを送信しました', null)
      },
      onError: (e) => setComposeError(toUserMessage(e)),
    })
  }

  function handleEnable() {
    setError(null)
    // 既に gmail.modify に同意済みの端末なら、再ログイン（同意フロー）を挟まず即有効化する。
    // 誤って非表示にしても、再度有効化するのに毎回ログインを求められないようにするため。
    if (hasScope) {
      setGmailEnabled(true)
      return
    }
    setConnecting(true)
    // ⚠ requestToken はこの同期フレームで走る必要がある（gisClient 実装）。
    connect(GMAIL_SCOPES)
      .then(() => {
        setGmailEnabled(true)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setConnecting(false))
  }

  // 未有効 or 未同意: 有効化を促す
  if (!active) {
    return (
      <div className="gmail__enable">
        <p className="panel__note">
          この端末では Gmail は表示していません。有効にすると受信トレイのメールを表示します。
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
      {/* 見出し行に「作成」ボタンを置く（新規メール作成）。 */}
      <div className="gmail__toolbar">
        <h2 className="panel__title">受信トレイ</h2>
        <button className="btn btn--small btn--primary" onClick={() => openCompose({ mode: 'new' })}>
          ✎ 作成
        </button>
      </div>

      <GmailList
        messages={messages}
        isLoading={isLoading}
        isError={isError}
        error={queryError}
        onRetry={() => refetch()}
        formatWhen={formatWhen}
        onOpen={setSelected}
      />

      {/* メール本文はパネル内展開ではなくモーダルで開く（読みやすさ・操作しやすさのため）。 */}
      {selected && (
        <MessageModal
          message={selected}
          onClose={() => setSelected(null)}
          onMarkRead={(m) => {
            handleMarkRead(m)
            setSelected(null)
          }}
          onMarkUnread={(m) => {
            handleMarkUnread(m)
            setSelected(null)
          }}
          onArchive={(m) => {
            handleArchive(m)
            setSelected(null)
          }}
          onReply={(m) => {
            setSelected(null)
            openCompose({ mode: 'reply', message: m })
          }}
        />
      )}

      {compose && (
        <ComposeSheet
          state={compose}
          sending={send.isPending}
          error={composeError}
          onClose={() => setCompose(null)}
          onSend={handleSend}
        />
      )}

      {/* スナックバー（画面下部固定・5秒）。Undo が無い通知（送信完了など）はボタンを出さない。 */}
      {snack && (
        <div className="snackbar" role="status">
          <span className="snackbar__text">{snack.text}</span>
          {snack.undo && (
            <button className="snackbar__action" onClick={handleSnackUndo}>
              元に戻す
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function GmailList({
  messages,
  isLoading,
  isError,
  error,
  onRetry,
  formatWhen,
  onOpen,
}: {
  messages: GmailMessage[] | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  onRetry: () => void
  formatWhen: (ms: number) => string
  onOpen: (m: GmailMessage) => void
}) {
  if (isLoading) {
    return <ListSkeleton rows={6} />
  }
  if (isError) {
    return <PanelError message="メールの取得に失敗しました" error={error} onRetry={onRetry} />
  }
  if (!messages || messages.length === 0) {
    return <p className="panel__note">受信トレイにメールはありません。</p>
  }

  // 未読を上・既読を下に並べたうえで、既読の先頭に区切り見出し「既読」を挿す。
  // 未読が1件も無い（全部既読）の場合は見出しを出さない。
  const firstReadIdx = messages.findIndex((m) => !m.unread)
  return (
    <ul className="gmail__list">
      {messages.map((m, i) => (
        <Fragment key={m.id}>
          {i === firstReadIdx && firstReadIdx > 0 && (
            <li className="gmail__divider" aria-hidden="true">
              既読
            </li>
          )}
          <GmailRow m={m} formatWhen={formatWhen} onOpen={onOpen} />
        </Fragment>
      ))}
    </ul>
  )
}

// 1件のメール行。タップで本文モーダルを開く（本文・操作はモーダル側）。
function GmailRow({
  m,
  formatWhen,
  onOpen,
}: {
  m: GmailMessage
  formatWhen: (ms: number) => string
  onOpen: (m: GmailMessage) => void
}) {
  return (
    <li className={`gmail__item${m.unread ? '' : ' gmail__item--read'}`}>
      <button type="button" className="gmail__row" onClick={() => onOpen(m)}>
        <div className="gmail__line1">
          <span className="gmail__from">{m.fromName}</span>
          <span className="gmail__when">{formatWhen(m.dateMs)}</span>
        </div>
        <div className="gmail__subject">{m.subject}</div>
        <div className="gmail__snippet">{m.snippet}</div>
      </button>
    </li>
  )
}

// メール本文モーダル。差出人・件名・日時のヘッダ＋操作（返信・既読/未読・アーカイブ）＋本文を、
// パネル内展開ではなく画面中央の広いモーダルで開く（読みやすさ・操作しやすさのため）。
function MessageModal({
  message: m,
  onClose,
  onMarkRead,
  onMarkUnread,
  onArchive,
  onReply,
}: {
  message: GmailMessage
  onClose: () => void
  onMarkRead: (m: GmailMessage) => void
  onMarkUnread: (m: GmailMessage) => void
  onArchive: (m: GmailMessage) => void
  onReply: (m: GmailMessage) => void
}) {
  const dialogRef = useDialog<HTMLDivElement>(onClose)
  const when = m.dateMs ? new Date(m.dateMs).toLocaleString('ja-JP') : ''
  // 外部画像の表示状態はモーダル側で持ち、「画像を表示」ボタンを本文の上ではなく
  // 操作ボタン列（返信・既読/未読・アーカイブ）に並べる（本文の上に単独行で出ると浮くため）。
  // imagesBlocked は本文が読み込まれてブロック画像を含むと HtmlBody から通知される。
  const [showImages, setShowImages] = useState(false)
  const [imagesBlocked, setImagesBlocked] = useState(false)
  // メールが変わったら「画像を表示」の解禁状態だけリセットする。
  // imagesBlocked は本文（HtmlBody/MessageBody）からの通知が唯一のソースなのでここでは触らない
  // （ここで false にすると、キャッシュ即描画時に子の true 通知を同一コミットで打ち消してしまい、
  //   一度見た HTML メールの再オープンでボタンが出なくなる。Fable 指摘）。
  useEffect(() => {
    setShowImages(false)
  }, [m.id])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal gmail-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="メール"
      >
        {/* 件名と×は上部に固定（本文を下にスクロールしても常に見える）。 */}
        <div className="modal__header gmail-modal__header">
          <h3 className="modal__title gmail-modal__subject">{m.subject}</h3>
          <button className="modal__close" onClick={onClose} aria-label="閉じる" title="閉じる">
            ×
          </button>
        </div>
        <div className="gmail-modal__scroll">
          <div className="gmail-modal__meta">
            <span className="gmail-modal__from">{m.fromName}</span>
            {m.fromEmail && m.fromEmail !== m.fromName && (
              <span className="gmail-modal__email">{m.fromEmail}</span>
            )}
            {when && <span className="gmail-modal__when">{when}</span>}
          </div>
          <div className="gmail__actions">
            {/* 返信（作成シートを開く）。差出人宛・件名 Re:・本文引用がプリフィルされる。 */}
            <button className="btn btn--small btn--primary" onClick={() => onReply(m)}>
              返信
            </button>
            {/* 未読なら「既読にする」、既読なら「未読にする」を出す。どちらもアーカイブ可。 */}
            {m.unread ? (
              <button className="btn btn--small" onClick={() => onMarkRead(m)}>
                既読にする
              </button>
            ) : (
              <button className="btn btn--small" onClick={() => onMarkUnread(m)}>
                未読にする
              </button>
            )}
            <button className="btn btn--small" onClick={() => onArchive(m)}>
              アーカイブ
            </button>
            {/* 外部画像がブロックされている本文でのみ、操作列に「画像を表示」を並べる。 */}
            {imagesBlocked && !showImages && (
              <button className="btn btn--small" onClick={() => setShowImages(true)}>
                画像を表示
              </button>
            )}
          </div>
          <MessageBody
            id={m.id}
            showImages={showImages}
            onImagesBlockedChange={setImagesBlocked}
          />
        </div>
      </div>
    </div>
  )
}

// 本文プレビュー本体。HTML はサニタイズして sandbox iframe に隔離表示、
// プレーンテキストのみなら <pre> にそのまま出す（HTML でないので iframe 不要）。
// 本文の下に添付ファイル一覧（#13）を出す。
// 「画像を表示」ボタンはモーダルの操作列に置くため、表示状態(showImages)は親から受け取り、
// ブロック画像の有無(onImagesBlockedChange)を親へ通知する。
function MessageBody({
  id,
  showImages,
  onImagesBlockedChange,
}: {
  id: string
  showImages: boolean
  onImagesBlockedChange: (blocked: boolean) => void
}) {
  const { data, isLoading, isError, error } = useMessageBody(id)
  // HTML 本文でない（プレーン/本文なし）ときはブロック画像も無いので false を通知する。
  const html = data?.html ?? null
  useEffect(() => {
    if (!html) onImagesBlockedChange(false)
  }, [html, onImagesBlockedChange])

  if (isLoading) return <p className="panel__note gmail__bodynote">本文を読み込み中…</p>
  if (isError)
    return (
      <p className="panel__note panel__note--error gmail__bodynote">
        本文の取得に失敗しました: {toUserMessage(error)}
      </p>
    )
  if (!data) return null
  return (
    <>
      {data.html ? (
        <HtmlBody
          html={data.html}
          showImages={showImages}
          onImagesBlockedChange={onImagesBlockedChange}
        />
      ) : data.text ? (
        <PlainTextBody text={data.text} />
      ) : data.attachments.length === 0 ? (
        <p className="panel__note gmail__bodynote">本文を表示できません</p>
      ) : null}
      {data.attachments.length > 0 && <AttachmentList messageId={id} attachments={data.attachments} />}
    </>
  )
}

// 添付ファイル一覧（#13）。各行タップで attachments.get から実データを取得し、ブラウザ保存を起こす。
function AttachmentList({
  messageId,
  attachments,
}: {
  messageId: string
  attachments: Attachment[]
}) {
  // ダウンロード中の attachmentId（多重クリック防止・進捗表示用）と直近のエラー。
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errorId, setErrorId] = useState<string | null>(null)

  async function download(att: Attachment) {
    setBusyId(att.attachmentId)
    setErrorId(null)
    try {
      const bytes = await fetchAttachmentBytes(messageId, att.attachmentId)
      // Uint8Array から Blob を作り、一時 <a download> でブラウザの保存を起こす。
      const blob = new Blob([bytes as BlobPart], { type: att.mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = att.filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      // 認証切れ(401)は共通の再接続UXへ流す（この経路は TanStack Query を通らないため手動で連携）。
      if (e instanceof AuthError) markExpired()
      setErrorId(att.attachmentId)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="gmail__attachments">
      <div className="gmail__attachments-title">添付ファイル（{attachments.length}）</div>
      <ul className="gmail__attachment-list">
        {attachments.map((att) => (
          <li key={att.attachmentId}>
            <button
              type="button"
              className="gmail__attachment"
              onClick={() => download(att)}
              disabled={busyId === att.attachmentId}
            >
              <span className="gmail__attachment-icon" aria-hidden>
                📎
              </span>
              <span className="gmail__attachment-name">{att.filename}</span>
              <span className="gmail__attachment-meta">
                {busyId === att.attachmentId ? '取得中…' : formatBytes(att.size)}
              </span>
            </button>
            {errorId === att.attachmentId && (
              <p className="panel__note panel__note--error gmail__bodynote">
                添付ファイルの取得に失敗しました
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// プレーンテキスト本文。改行・空白は <pre> で保ちつつ、生の URL はリンク化して押せるようにする
// （メール本文に貼られた URL がただの文字列で押せない、というユーザー要望への対応）。
function PlainTextBody({ text }: { text: string }) {
  const tokens = tokenizeLinks(text)
  return (
    <pre className="gmail__text">
      {tokens.map((t, i) =>
        t.href ? (
          <a key={i} href={t.href} target="_blank" rel="noopener noreferrer">
            {t.text}
          </a>
        ) : (
          t.text
        ),
      )}
    </pre>
  )
}

// サニタイズ済みHTMLを sandbox iframe で表示。外部画像は既定でブロックし、
// 「画像を表示」（モーダルの操作列にある）で解禁する（CSP を緩めた srcdoc に差し替え）。
// showImages は親（モーダル）から受け取り、ブロック画像の有無は親へ通知する。
function HtmlBody({
  html,
  showImages,
  onImagesBlockedChange,
}: {
  html: string
  showImages: boolean
  onImagesBlockedChange: (blocked: boolean) => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  // 中身の高さを監視するオブザーバ。srcDoc 差し替え時に前の監視を止めて張り直す。
  const observerRef = useRef<ResizeObserver | null>(null)
  const dark = useEffectiveDark()
  const sanitized = useMemo(() => sanitizeEmailHtml(html), [html])
  const imagesBlocked = useMemo(() => hasBlockedImages(sanitized), [sanitized])
  const srcDoc = useMemo(() => buildSrcDoc(sanitized, showImages, dark), [sanitized, showImages, dark])

  // ブロック画像の有無を親（モーダル）へ通知し、操作列の「画像を表示」の出し分けに使わせる。
  useEffect(() => {
    onImagesBlockedChange(imagesBlocked)
  }, [imagesBlocked, onImagesBlockedChange])

  // アンマウント時に高さ監視を止める（監視が残るとメモリリークになる）。
  useEffect(() => () => observerRef.current?.disconnect(), [])

  // iframe の中身の高さに合わせて iframe 自体の高さを「常時」追従させる。
  // 一度きりの測定だと、画像や Web フォントが後から読み込まれて中身が伸びたとき iframe が
  // 短いままになり、iframe の内部に縦スクロールが生まれる。その内部スクロールがマウス/指の
  // スクロールを奪うため、親パネルのスクロールがひっかかる（HTML メール特有の症状）。
  // ResizeObserver で中身の高さへ常に合わせておけば iframe 内部はスクロール不要になり、
  // スクロールは親パネル側へそのまま流れる（iframe には scrolling="no" も付けて二重に防ぐ）。
  // sandbox に allow-scripts は付けないので中身の JS は実行されない（allow-same-origin のみ）。
  // allow-same-origin なので、隔離されていない本体側から中身の高さを測りリンククリックを横取りできる。
  function handleLoad() {
    const f = frameRef.current
    try {
      const doc = f?.contentDocument
      if (!doc || !doc.body) return
      const syncHeight = () => {
        const h = doc.body.scrollHeight
        if (h > 0) f!.style.height = `${h + 16}px`
      }
      syncHeight()
      // 前の本文の監視を止めてから、現在の本文を監視する（画像読み込み・折返しで再計測）。
      observerRef.current?.disconnect()
      const ro = new ResizeObserver(syncHeight)
      ro.observe(doc.body)
      observerRef.current = ro
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
      <iframe
        ref={frameRef}
        className="gmail__frame"
        title="メール本文"
        // sandbox の各トークンは意図的（#53 で確認）。⚠ allow-scripts は絶対に追加しない
        // （追加すると本文の JS が本体オリジンで実行され、多層防御が崩れる。詳細は #43）。
        //  - allow-same-origin: 高さ計測・Android のリンク横取りで contentDocument を読むため。
        //  - allow-popups: リンク(target="_blank")で新規タブを開けるようにするため。
        //  - allow-popups-to-escape-sandbox: 開いた外部サイトが sandbox（スクリプト無効）を
        //    継承して壊れるのを防ぐため必要。外すとリンク先が正しく表示できない。
        // 【設計判断・#43】より厳格にするなら allow-same-origin を外し、高さ計測を
        // iframe 内スクリプトからの postMessage に切り替える案がある。ただし本アプリは
        //   (1) allow-scripts を付けない方針（本文JSを一切実行しない多層防御）なので iframe 内から
        //       postMessage を送る手段が無く、
        //   (2) Android の外部リンク横取り（#14）が本体側からの contentDocument 参照に依存している
        // ため、allow-same-origin を外すと成立しない。よって現時点では allow-same-origin を維持し、
        // 高さは本体側の ResizeObserver（handleLoad）で計測する。#14 の実機検証後に再検討する。
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        // iframe 自身のスクロールを無効化し、スクロールを親パネルへ流す（ひっかかり防止）。
        // 高さは handleLoad の ResizeObserver で中身に追従させるので内部スクロールは不要。
        scrolling="no"
        srcDoc={srcDoc}
        onLoad={handleLoad}
      />
    </div>
  )
}

// メール作成・返信シート（#4）。宛先・件名・本文を入力して送信する。
// 返信のときは差出人宛・件名 Re:・本文引用をプリフィルし、スレッド・参照ヘッダで会話にぶら下げる。
function ComposeSheet({
  state,
  sending,
  error,
  onClose,
  onSend,
}: {
  state: Exclude<ComposeState, null>
  sending: boolean
  error: string | null
  onClose: () => void
  onSend: (msg: OutgoingMessage) => void
}) {
  const isReply = state.mode === 'reply'
  const replyTo = state.mode === 'reply' ? state.message : null

  // 返信の引用用に元本文（プレーンテキスト）を取得（一覧で開いた本文がキャッシュ済みなら再取得しない）。
  const bodyQuery = useMessageBody(isReply ? (replyTo as GmailMessage).id : null)
  // 返信のスレッド化に使う In-Reply-To / References を取得。
  const refsQuery = useQuery({
    queryKey: ['gmail', 'replyRefs', replyTo?.id],
    queryFn: () => fetchReplyRefs((replyTo as GmailMessage).id),
    enabled: isReply && !!replyTo,
    staleTime: 10 * 60 * 1000,
  })

  const [to, setTo] = useState(isReply ? (replyTo as GmailMessage).fromEmail : '')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(
    isReply ? replySubject((replyTo as GmailMessage).subject) : '',
  )
  const [body, setBody] = useState('')
  // 返信本文（引用）は元本文の取得完了後に一度だけ差し込む（ユーザーが打ち始めたら上書きしない）。
  const quotedRef = useRef(false)
  // 宛先・件名の確定プリフィル（Reply-To 優先・生件名）も、メタ取得完了後に一度だけ反映する。
  const metaRef = useRef(false)

  const dialogRef = useDialog<HTMLFormElement>(onClose)

  useEffect(() => {
    if (!isReply || quotedRef.current || !bodyQuery.isSuccess) return
    quotedRef.current = true
    const rt = replyTo as GmailMessage
    setBody(quoteBody(rt.fromName, rt.dateMs, bodyQuery.data?.text ?? ''))
  }, [isReply, bodyQuery.isSuccess, bodyQuery.data, replyTo])

  useEffect(() => {
    if (!isReply || metaRef.current || !refsQuery.isSuccess) return
    metaRef.current = true
    const rt = replyTo as GmailMessage
    // Reply-To 指定があればそれを宛先にする（メーリングリスト等で From と返信先が違う場合の対応）。
    if (refsQuery.data.replyToAddress) setTo(refsQuery.data.replyToAddress)
    // 生件名で Re: を作り直す（一覧の表示用プレースホルダ「(件名なし)」が件名に漏れるのを防ぐ）。
    setSubject(replySubject(refsQuery.data.subject || rt.subject))
  }, [isReply, refsQuery.isSuccess, refsQuery.data, replyTo])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!to.trim() || sending) return
    onSend({
      to: to.trim(),
      cc: cc.trim() || undefined,
      subject: subject.trim(),
      body,
      threadId: replyTo?.threadId,
      inReplyTo: refsQuery.data?.inReplyTo,
      references: refsQuery.data?.references,
    })
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form
        ref={dialogRef}
        tabIndex={-1}
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-label={isReply ? 'メールに返信' : 'メールを作成'}
      >
        <h3 className="sheet__title">{isReply ? '返信' : 'メールを作成'}</h3>

        <label className="sheet__label" htmlFor="cmp-to">
          宛先
        </label>
        <input
          id="cmp-to"
          className="tasks__add-input"
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="宛先メールアドレス（カンマ区切りで複数可）"
          autoComplete="off"
        />

        <label className="sheet__label" htmlFor="cmp-cc">
          Cc（任意）
        </label>
        <input
          id="cmp-cc"
          className="tasks__add-input"
          type="text"
          value={cc}
          onChange={(e) => setCc(e.target.value)}
          placeholder="Cc（任意）"
          autoComplete="off"
        />

        <label className="sheet__label" htmlFor="cmp-subject">
          件名
        </label>
        <input
          id="cmp-subject"
          className="tasks__add-input"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="件名"
        />

        <label className="sheet__label" htmlFor="cmp-body">
          本文
        </label>
        <textarea
          id="cmp-body"
          className="tasks__add-input sheet__textarea gmail__compose-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="本文を入力"
          rows={8}
        />

        {isReply && refsQuery.isError && (
          <p className="panel__note gmail__bodynote">
            ※ 元メール情報を取得できなかったため、返信がスレッドに紐づかない場合があります。
          </p>
        )}
        {error && <p className="welcome__error">{error}</p>}

        <div className="sheet__buttons">
          <button type="button" className="btn btn--small" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="submit"
            className="btn btn--small btn--primary"
            // 返信はスレッド化メタ（In-Reply-To/References）の取得完了まで送信を待つ
            // （未取得のまま送るとスレッドに紐づかないため）。
            disabled={!to.trim() || sending || (isReply && refsQuery.isPending)}
          >
            {sending ? '送信中…' : '送信'}
          </button>
        </div>
      </form>
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
