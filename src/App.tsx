import { useEffect, useState } from 'react'
import { CALENDAR_SCOPES, isClientIdConfigured } from './config'
import {
  connect,
  hasPreviousCalendarGrant,
  prepareAuth,
  trySilentConnect,
  useAuth,
} from './auth/useAuth'
import { CalendarPanel } from './features/calendar/CalendarPanel'

// フェーズ2の画面。ウェルカム（未ログイン）→ ログイン → カレンダー7日分表示。
// 主目的は iPhone PWA ログイン検証と再ログイン頻度検証のため、UI は最小限に留める。
export default function App() {
  const { isConnected, needsReconnect, acquiredAt } = useAuth()
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  // 起動直後にサイレント認証を試している間の状態（ログインボタンの一瞬の点滅を防ぐ）
  const [initializing, setInitializing] = useState(isClientIdConfigured && hasPreviousCalendarGrant())

  // 起動時: GIS を事前準備し、以前接続済みの端末ならサイレント認証を試みる。
  // 成功すれば自動でログイン状態になり、毎回のログインクリックが不要になる。
  useEffect(() => {
    if (!isClientIdConfigured) return
    if (hasPreviousCalendarGrant()) {
      // 以前同意済み → ポップアップ無しの自動ログインを試す
      trySilentConnect(CALENDAR_SCOPES).finally(() => setInitializing(false))
    } else {
      // 初回端末 → クリックで即トークン要求できるよう事前準備だけしておく
      prepareAuth(CALENDAR_SCOPES).catch(() => {
        // 読み込み失敗はログイン試行時にエラー表示するのでここでは握りつぶす
      })
    }
  }, [])

  const handleConnect = () => {
    setConnectError(null)
    setConnecting(true)
    // ⚠ requestToken 自体はこの同期フレーム内で走る（gisClient 実装）。
    connect(CALENDAR_SCOPES)
      .catch((e: unknown) => setConnectError(e instanceof Error ? e.message : String(e)))
      .finally(() => setConnecting(false))
  }

  // クライアントID未設定なら、まず設定を促す
  if (!isClientIdConfigured) {
    return (
      <main className="welcome">
        <h1 className="welcome__title">AB Operations</h1>
        <p className="welcome__lead">
          Google の OAuth クライアントID が未設定です。
          <br />
          <code>src/config.ts</code> の <code>GOOGLE_CLIENT_ID</code> に発行済みのIDを設定してください。
        </p>
      </main>
    )
  }

  // 起動時のサイレント認証を試行中: ログインボタンを点滅させず読み込み表示にする
  if (initializing && !isConnected && !needsReconnect) {
    return (
      <main className="welcome">
        <h1 className="welcome__title">AB Operations</h1>
        <p className="welcome__lead">接続中…</p>
      </main>
    )
  }

  // 未ログイン（初回）: アプリ名＋ログインボタンだけのウェルカム画面
  if (!isConnected && !needsReconnect) {
    return (
      <main className="welcome">
        <h1 className="welcome__title">AB Operations</h1>
        <p className="welcome__lead">Google カレンダー・タスク・メールを1画面に。</p>
        <button className="btn btn--primary" onClick={handleConnect} disabled={connecting}>
          {connecting ? '接続中…' : 'Google でログイン'}
        </button>
        {connectError && <p className="welcome__error">ログインに失敗しました: {connectError}</p>}
      </main>
    )
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">AB Operations</h1>
        <ConnectionStatus
          acquiredAt={acquiredAt}
          needsReconnect={needsReconnect}
          connecting={connecting}
          onReconnect={handleConnect}
        />
      </header>

      {/* セッション切れバナー（画面上部に1本だけ） */}
      {needsReconnect && (
        <div className="banner banner--warn" role="alert">
          <span>接続が切れました。</span>
          <button className="btn btn--small" onClick={handleConnect} disabled={connecting}>
            {connecting ? '再接続中…' : '再接続'}
          </button>
        </div>
      )}

      <main className="app__main">
        <section className="panel">
          <h2 className="panel__title">予定（今後7日間）</h2>
          <CalendarPanel />
        </section>
      </main>
    </div>
  )
}

// 接続状態＝トークン取得時刻の表示。再ログイン頻度の実機検証用の計測点。
function ConnectionStatus({
  acquiredAt,
  needsReconnect,
  connecting,
  onReconnect,
}: {
  acquiredAt: number | null
  needsReconnect: boolean
  connecting: boolean
  onReconnect: () => void
}) {
  if (needsReconnect) {
    return (
      <button className="btn btn--small" onClick={onReconnect} disabled={connecting}>
        再接続
      </button>
    )
  }
  if (!acquiredAt) return null
  const time = new Date(acquiredAt).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return <span className="app__status">接続: {time} 取得（約1時間で失効）</span>
}
