// 設定モーダル。項目が増えてきたので、区画をタブで分けて一望性を上げる:
//  - 表示     … この端末の表示設定（テーマ・Gmail 表示・出典名・週開始・天気の地点。端末ローカル）
//  - アカウント … ログイン中のメール表示・サインアウト / 接続状態・再接続
//  - 情報     … アプリ情報（ビルド版＝コミットハッシュ・ビルド日時）

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
import {
  MAX_SELECTED_SOURCES,
  NEWS_SOURCES,
  setSelectedNewsSources,
  useSelectedNewsSources,
} from '../news/newsSource'
import type { NewsSource } from '../news/newsSource'
import { geocodeLocation } from '../weather/api'
import type { GeocodeResult } from '../weather/api'
import { setWeatherLocation, useWeatherLocation } from '../weather/location'

// 設定タブの識別子と見出し。
type SettingsTab = 'display' | 'account' | 'about'
const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'display', label: '表示' },
  { key: 'account', label: 'アカウント' },
  { key: 'about', label: '情報' },
]

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
  // 開いている区画（既定は「表示」＝一番よく触る端末表示設定）。
  const [activeTab, setActiveTab] = useState<SettingsTab>('display')

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

        {/* エラーはどのタブの操作でも起こりうるので、タブより上に常時表示する。 */}
        {error && <p className="welcome__error">{error}</p>}

        {/* 区分タブ（表示 / アカウント / 情報）。 */}
        <div className="settings__tabs" role="tablist" aria-label="設定の区分">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab === t.key}
              className={`settings__tab${activeTab === t.key ? ' settings__tab--active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="settings__panel">
          {/* 表示: この端末の表示設定 */}
          {activeTab === 'display' && (
            <section className="settings__section">
              <p className="settings__note">これらの設定はこの端末だけに保存されます。</p>
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
              <p className="settings__note">
                OFF にすると、メール枠の代わりにニュースを表示します。表示するソースは下で選べます。
              </p>
              <NewsSourceSetting />
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
              <WeatherLocationSetting />
            </section>
          )}

          {/* アカウント: ログイン情報・ログアウト / 接続状態・再接続 */}
          {activeTab === 'account' && (
            <>
              <section className="settings__section">
                <h3 className="settings__heading">アカウント</h3>
                <p className="settings__value">{emailLoading ? '取得中…' : email || '（不明）'}</p>
                <button className="btn btn--small" onClick={handleLogout} disabled={busy}>
                  ログアウト
                </button>
              </section>

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
            </>
          )}

          {/* 情報: アプリのビルド版 */}
          {activeTab === 'about' && (
            <section className="settings__section">
              <h3 className="settings__heading">アプリ情報</h3>
              <p className="settings__value settings__value--mono">
                版 {__COMMIT_HASH__} / ビルド {buildText}
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

// ニュースソースの選択（最大3つ）。チェックした順にニュースパネルのタブに並ぶ。
// 全ソースとも APIキー不要・CORS 対応・JSON 直取り（news/api.ts 参照）。
function NewsSourceSetting() {
  const selected = useSelectedNewsSources()
  const atMax = selected.length >= MAX_SELECTED_SOURCES

  function toggle(key: NewsSource, checked: boolean) {
    if (checked) {
      if (selected.includes(key) || atMax) return
      setSelectedNewsSources([...selected, key]) // 選んだ順にタブへ並べる
    } else {
      if (selected.length <= 1) return // 最低1つは残す
      setSelectedNewsSources(selected.filter((k) => k !== key))
    }
  }

  return (
    <div className="settings__news">
      <div className="settings__row">
        <span>ニュースのソース（最大{MAX_SELECTED_SOURCES}つ）</span>
        <span className="settings__value">
          {selected.length}/{MAX_SELECTED_SOURCES}
        </span>
      </div>
      <ul className="settings__news-list">
        {NEWS_SOURCES.map((s) => {
          const checked = selected.includes(s.key)
          // 上限到達時は未選択のものだけ無効化。最後の1つは外せないよう無効化。
          const disabled = (!checked && atMax) || (checked && selected.length <= 1)
          return (
            <li key={s.key} className="settings__news-item">
              <label className="settings__news-label">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => toggle(s.key, e.target.checked)}
                />
                <span className="settings__news-name">{s.label}</span>
                <span className="settings__news-desc">{s.description}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <p className="settings__note">
        チェックした順にニュースパネル上部のタブとして並びます（この端末だけに保存）。
      </p>
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
