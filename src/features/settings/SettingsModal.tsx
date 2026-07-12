// 設定モーダル。4つの区画をまとめる:
//  1. アカウント / ログアウト（ログイン中のメール表示・サインアウト）
//  2. この端末の表示設定（Gmail の表示 ON/OFF。端末ローカル）
//  3. 接続状態 / 再接続（トークン取得時刻・再接続ボタン）
//  4. アプリ情報（ビルド版＝コミットハッシュ・ビルド日時）

import { useState } from 'react'
import { GMAIL_SCOPES, INITIAL_SCOPES, SCOPES } from '../../config'
import { connect, disconnect, useAuth } from '../../auth/useAuth'
import { setGmailEnabled, useGmailEnabled } from '../gmail/enabled'
import { useAccountEmail } from './useAccountEmail'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { needsReconnect, acquiredAt, grantedScopes } = useAuth()
  const { data: email, isLoading: emailLoading } = useAccountEmail()
  const gmailEnabled = useGmailEnabled()
  const gmailHasScope = grantedScopes.includes(SCOPES.gmailModify)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleLogout() {
    // 確認なしで即実行しない: 誤タップ防止に確認を挟む
    if (!window.confirm('ログアウトしますか？（再度ログインが必要になります）')) return
    disconnect()
    onClose()
  }

  function handleReconnect() {
    setError(null)
    setBusy(true)
    // Gmail 有効端末では Gmail 込みのスコープで、それ以外は初期スコープで再接続する。
    connect(gmailEnabled && gmailHasScope ? GMAIL_SCOPES : INITIAL_SCOPES)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }

  // Gmail 表示トグル。ON にするには gmail.modify の同意が要る（未同意なら同意フローを走らせる）。
  function handleToggleGmail() {
    if (gmailEnabled) {
      setGmailEnabled(false)
      return
    }
    if (gmailHasScope) {
      setGmailEnabled(true)
      return
    }
    // 未同意: 追加同意（union スコープ）を要求してから有効化する。
    setError(null)
    setBusy(true)
    connect(GMAIL_SCOPES)
      .then(() => setGmailEnabled(true))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }

  const acquiredText = acquiredAt
    ? new Date(acquiredAt).toLocaleString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'
  const buildText = new Date(__BUILD_TIME__).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="設定"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 className="modal__title">設定</h2>
          <button className="modal__close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>

        {error && <p className="welcome__error">{error}</p>}

        {/* 1. アカウント / ログアウト */}
        <section className="settings__section">
          <h3 className="settings__heading">アカウント</h3>
          <p className="settings__value">
            {emailLoading ? '取得中…' : email || '（不明）'}
          </p>
          <button className="btn btn--small" onClick={handleLogout} disabled={busy}>
            ログアウト
          </button>
        </section>

        {/* 2. この端末の表示設定 */}
        <section className="settings__section">
          <h3 className="settings__heading">この端末の表示</h3>
          <label className="settings__row">
            <span>メール（Gmail）を表示</span>
            <input
              type="checkbox"
              checked={gmailEnabled && gmailHasScope}
              disabled={busy}
              onChange={handleToggleGmail}
            />
          </label>
          <p className="settings__note">
            この設定はこの端末だけに保存されます（会社PCなど端末ごとに切り替えられます）。
          </p>
        </section>

        {/* 3. 接続状態 / 再接続 */}
        <section className="settings__section">
          <h3 className="settings__heading">接続状態</h3>
          <p className="settings__value">
            {needsReconnect ? '接続が切れています' : `トークン取得: ${acquiredText}（約1時間で失効）`}
          </p>
          <button className="btn btn--small" onClick={handleReconnect} disabled={busy}>
            {busy ? '接続中…' : '再接続'}
          </button>
        </section>

        {/* 4. アプリ情報 */}
        <section className="settings__section">
          <h3 className="settings__heading">アプリ情報</h3>
          <p className="settings__value settings__value--mono">
            版 {__COMMIT_HASH__} / ビルド {buildText}
          </p>
        </section>
      </div>
    </div>
  )
}
