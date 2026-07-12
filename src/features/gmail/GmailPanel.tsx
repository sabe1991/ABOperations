// Gmail パネル（フェーズ5の最初のスライス: 受信トレイの未読一覧のみ）。
// - この端末で未有効 or 未同意なら「Gmail を有効にする」ボタンを出す（端末ごとの任意有効化）。
// - 有効化時は union スコープ（既存 + gmail.modify）をまとめて要求し、1本のトークンに全部載せる。
// - 有効なら未読メールを一覧表示（差出人・件名・日時・スニペット）。本文表示や既読化は次スライス。

import { useState } from 'react'
import { GMAIL_SCOPES, SCOPES } from '../../config'
import { connect, useAuth } from '../../auth/useAuth'
import { isGmailEnabled, setGmailEnabled } from './enabled'
import { useGmail } from './useGmail'
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
        <li key={m.id} className="gmail__item">
          <div className="gmail__line1">
            <span className="gmail__from">{m.fromName}</span>
            <span className="gmail__when">{formatWhen(m.dateMs)}</span>
          </div>
          <div className="gmail__subject">{m.subject}</div>
          <div className="gmail__snippet">{m.snippet}</div>
        </li>
      ))}
    </ul>
  )
}
