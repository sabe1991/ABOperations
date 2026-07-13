// 設定モーダル。4つの区画をまとめる:
//  1. アカウント / ログアウト（ログイン中のメール表示・サインアウト）
//  2. この端末の表示設定（Gmail の表示 ON/OFF。端末ローカル）
//  3. 接続状態 / 再接続（トークン取得時刻・再接続ボタン）
//  4. アプリ情報（ビルド版＝コミットハッシュ・ビルド日時）

import { useState } from 'react'
import { GMAIL_SCOPES, SCOPES } from '../../config'
import { connect, disconnect, useAuth } from '../../auth/useAuth'
import { desiredScopes } from '../../auth/scopes'
import { setGmailEnabled, useGmailEnabled } from '../gmail/enabled'
import {
  setShowSourceLabels,
  setTheme,
  setWeekStart,
  useShowSourceLabels,
  useTheme,
  useWeekStart,
} from './displayPrefs'
import type { Theme } from './displayPrefs'
import { useAccountEmail } from './useAccountEmail'
import { geocodeLocation } from '../weather/api'
import type { GeocodeResult } from '../weather/api'
import { setWeatherLocation, useWeatherLocation } from '../weather/location'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { needsReconnect, acquiredAt, grantedScopes } = useAuth()
  const { data: email, isLoading: emailLoading } = useAccountEmail()
  const gmailEnabled = useGmailEnabled()
  const showSourceLabels = useShowSourceLabels()
  const weekStart = useWeekStart()
  const theme = useTheme()
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
    // 要求スコープの判断は全接続入口で共通の desiredScopes に集約している
    // （Gmail 有効端末では Gmail 込み、それ以外は初期スコープ）。
    connect(desiredScopes())
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
          <p className="settings__value">{emailLoading ? '取得中…' : email || '（不明）'}</p>
          <button className="btn btn--small" onClick={handleLogout} disabled={busy}>
            ログアウト
          </button>
        </section>

        {/* 2. この端末の表示設定 */}
        <section className="settings__section">
          <h3 className="settings__heading">この端末の表示</h3>
          <label className="settings__row">
            <span>配色テーマ（明るさ）</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              <option value="system">端末の設定に合わせる</option>
              <option value="light">ライト（明るい）</option>
              <option value="dark">ダーク（暗い）</option>
            </select>
          </label>
          <label className="settings__row">
            <span>メール（Gmail）を表示</span>
            <input
              type="checkbox"
              checked={gmailEnabled && gmailHasScope}
              disabled={busy}
              onChange={handleToggleGmail}
            />
          </label>
          <label className="settings__row">
            <span>予定・タスクの出典名を表示</span>
            <input
              type="checkbox"
              checked={showSourceLabels}
              onChange={(e) => setShowSourceLabels(e.target.checked)}
            />
          </label>
          <p className="settings__note">
            ON
            にすると、予定にカレンダー名（主カレンダーはメールアドレス）、タスクにリスト名を表示します。既定は非表示です。
          </p>
          <label className="settings__row">
            <span>週の開始曜日</span>
            <select
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value === '1' ? 1 : 0)}
            >
              <option value={0}>日曜始まり</option>
              <option value={1}>月曜始まり</option>
            </select>
          </label>
          <p className="settings__note">
            これらの設定はこの端末だけに保存されます（会社PCなど端末ごとに切り替えられます）。
          </p>
          <WeatherLocationSetting />
        </section>

        {/* 3. 接続状態 / 再接続 */}
        <section className="settings__section">
          <h3 className="settings__heading">接続状態</h3>
          <p className="settings__value">
            {needsReconnect
              ? '接続が切れています'
              : `トークン取得: ${acquiredText}（約1時間で失効）`}
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

// 天気の表示地点の設定。地名を検索（Open-Meteo のジオコーディング）して候補から選ぶ。
// 選んだ地点は端末ローカルに保存し、天気パネルが即座にその地点で取得し直す。
function WeatherLocationSetting() {
  const current = useWeatherLocation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setGeoError(null)
    setResults(null)
    try {
      setResults(await geocodeLocation(q))
    } catch (err) {
      setGeoError(err instanceof Error ? err.message : String(err))
    } finally {
      setSearching(false)
    }
  }

  function handlePick(r: GeocodeResult) {
    setWeatherLocation({ name: r.name, latitude: r.latitude, longitude: r.longitude })
    setResults(null)
    setQuery('')
  }

  // 候補の表示名（例: 渋谷区（東京都）, 日本）。
  function resultLabel(r: GeocodeResult): string {
    const admin = r.admin1 ? `（${r.admin1}）` : ''
    const country = r.country ? `, ${r.country}` : ''
    return `${r.name}${admin}${country}`
  }

  return (
    <div className="settings__weather">
      <div className="settings__row">
        <span>天気の地点</span>
        <span className="settings__value">{current.name}</span>
      </div>
      <form className="settings__geo-form" onSubmit={handleSearch}>
        <input
          className="settings__geo-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ローマ字で検索（例: Osaka, Kyoto）"
          aria-label="天気の地点を地名で検索"
        />
        <button type="submit" className="btn btn--small" disabled={searching || !query.trim()}>
          {searching ? '検索中…' : '検索'}
        </button>
      </form>
      {geoError && <p className="settings__note settings__note--error">{geoError}</p>}
      {results && results.length === 0 && (
        <p className="settings__note">
          見つかりませんでした。地名はローマ字（例: Osaka, Sapporo）でお試しください。
        </p>
      )}
      {results && results.length > 0 && (
        <ul className="settings__geo-results">
          {results.map((r, i) => (
            <li key={`${r.latitude},${r.longitude},${i}`}>
              <button className="settings__geo-result" onClick={() => handlePick(r)}>
                {resultLabel(r)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="settings__note">
        地名をローマ字で検索して候補から選ぶと、天気パネルの地点が変わります（候補名は日本語で表示・この端末だけに保存）。
      </p>
    </div>
  )
}
