import { useEffect, useState } from 'react'
import { INITIAL_SCOPES, SCOPES, isClientIdConfigured } from './config'
import {
  connect,
  hasPreviousCalendarGrant,
  hasToken,
  prepareAuth,
  restoreSession,
  trySilentConnect,
  useAuth,
} from './auth/useAuth'
import { CalendarPanel } from './features/calendar/CalendarPanel'
import { TodayTimeline } from './features/calendar/TodayTimeline'
import { MonthCalendar } from './features/calendar/MonthCalendar'
import { TasksPanel } from './features/tasks/TasksPanel'
import { GmailPanel } from './features/gmail/GmailPanel'
import { WeatherPanel } from './features/weather/WeatherPanel'
import { useMediaQuery, WIDE_QUERY } from './useMediaQuery'
import { useOverdueCount } from './features/tasks/useTasks'
import { useUnreadCount } from './features/gmail/useGmail'
import { isGmailEnabled } from './features/gmail/enabled'
import { SettingsModal } from './features/settings/SettingsModal'

// パネルの識別子。スマホのタブ切替に使う（PC では3枚とも並べるので未使用）。
type PanelKey = 'calendar' | 'tasks' | 'gmail'
const TABS: { key: PanelKey; label: string }[] = [
  { key: 'calendar', label: '予定' },
  { key: 'tasks', label: 'タスク' },
  { key: 'gmail', label: 'メール' },
]

// メイン画面。ウェルカム（未ログイン）→ ログイン → 予定・タスク・メールの3パネル表示。
// レイアウトは PC=3カラム並列 / スマホ=下端タブで1枚ずつ切替。タブには未読・期限切れの件数バッジ。
export default function App() {
  const { isConnected, needsReconnect, needsScope, acquiredAt, grantedScopes } = useAuth()
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  // スマホで表示中のタブ（初期は「予定」固定＝朝イチで今日の予定を最初に見る想定・Fable 助言）。
  // PC では3枚とも並列表示するのでこの状態は使わない（CSS 側で切替）。
  const [tab, setTab] = useState<PanelKey>('calendar')
  // 設定モーダルの開閉。
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 密度型レイアウト（段積み3カラム）が有効な幅か。広い PC のときだけ
  // 新規の読み取り専用部品（24hタイムライン・月カレンダー・天気）を描画する（Fable 助言）。
  // 状態を持つ3パネル（予定7日リスト・タスク・Gmail）は常に単一インスタンスで描画し、
  // 位置と表示は CSS の grid-template-areas / display にだけ任せる（再マウントを避け状態保持）。
  const isWide = useMediaQuery(WIDE_QUERY)

  // タブのバッジ用の件数。親でも同じクエリを呼ぶが、queryKey が同じなので取得は重複せず
  // （dedupe）、select で件数だけ受けるので件数が変わらない限り再描画されない（Fable 助言）。
  const overdueCount = useOverdueCount()
  const gmailActive = isGmailEnabled() && grantedScopes.includes(SCOPES.gmailModify)
  const unreadCount = useUnreadCount(gmailActive)
  // タブごとのバッジ数（0 のタブは付けない）。予定タブはバッジ無し。
  const badges: Record<PanelKey, number> = { calendar: 0, tasks: overdueCount, gmail: unreadCount }

  // タブ切替時は先頭までスクロールを戻す（ページ全体スクロール方式のため、
  // 前のタブの途中位置が次のタブに引き継がれるのを防ぐ）。
  function selectTab(key: PanelKey) {
    setTab(key)
    window.scrollTo(0, 0)
  }
  // 起動直後に接続を復元/試行している間の状態（ログインボタンの一瞬の点滅を防ぐ）
  const [initializing, setInitializing] = useState(
    isClientIdConfigured && (hasToken() || hasPreviousCalendarGrant()),
  )

  // 起動時の接続復元。優先順:
  //   1. sessionStorage に有効なトークンがあれば即接続（ページ更新時の主経路）
  //   2. 無ければ、以前同意済みの端末ならサイレント認証を試す（別セッションからの復帰）
  //   3. どちらも無ければ、クリックで即ログインできるよう事前準備だけしておく
  useEffect(() => {
    if (!isClientIdConfigured) {
      setInitializing(false)
      return
    }
    // どの経路でも GIS を先読みしておく。復元済みでも「再接続」「許可する」ボタンを
    // 押した瞬間に同期的にトークン要求できるようにするため（未読込だと要求が失敗する）。
    prepareAuth(INITIAL_SCOPES).catch(() => {
      // 読み込み失敗はログイン/再接続の試行時にエラー表示するのでここでは握りつぶす
    })
    if (restoreSession()) {
      setInitializing(false)
      return
    }
    if (hasPreviousCalendarGrant()) {
      trySilentConnect(INITIAL_SCOPES).finally(() => setInitializing(false))
    } else {
      setInitializing(false)
    }
  }, [])

  const handleConnect = () => {
    setConnectError(null)
    setConnecting(true)
    // ⚠ requestToken 自体はこの同期フレーム内で走る（gisClient 実装）。
    connect(INITIAL_SCOPES)
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
        <div className="app__headerRight">
          <ConnectionStatus
            acquiredAt={acquiredAt}
            needsReconnect={needsReconnect}
            connecting={connecting}
            onReconnect={handleConnect}
          />
          <button
            className="app__settings"
            onClick={() => setSettingsOpen(true)}
            aria-label="設定を開く"
            title="設定"
          >
            ⚙
          </button>
        </div>
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

      {/* 権限不足バナー（例: タスク追加前の古い許可のまま使っている端末）。
          再ログインではなく不足スコープの追加同意を促す。 */}
      {!needsReconnect && needsScope && (
        <div className="banner banner--warn" role="alert">
          <span>タスクを表示するには追加の許可が必要です。</span>
          <button className="btn btn--small" onClick={handleConnect} disabled={connecting}>
            {connecting ? '許可を取得中…' : '許可する'}
          </button>
        </div>
      )}

      {/* 状態を持つ3パネル（予定7日リスト・タスク・Gmail）は常に全てマウントしておく（Fable 助言）。
          スマホでは非選択タブを CSS で隠すだけなので、タブを行き来してもスクロール位置や展開状態が
          保持され、裏側の取得も途切れない。レイアウトは3状態（index.css 参照）:
            - 〜959px（スマホ）: タブで1枚だけ表示。
            - 960〜1199px（中間幅）: 予定・タスク・Gmail の3カラムリスト。
            - 1200px〜（密度型）: 段積み3カラム。ここでだけ新規の読み取り専用部品を追加描画する。
          密度型の新規部品（24hタイムライン・月カレンダー・天気）は読み取り専用で、幅の境界を
          またいで再マウントされても React Query のキャッシュから即復元されるため実害がない。
          DOM は grid-template-areas が効くようフラットな6グリッドアイテムにする（入れ子を挟まない）。
          広い画面（≥960px）では各パネルを「見出し（固定）＋中身（.panel__body で内部スクロール）」の
          縦積みにし、パネルの高さを画面高で固定する（項目数で全体の縦がガタつかない）。.panel__body の
          ラッパーは全幅で常に描画するので、コンポーネントの親は変わらず再マウントは起きない。 */}
      <main className="app__main">
        <div className="panels">
          {isWide && (
            <section className="panel panel--timeline">
              <h2 className="panel__title">今日の予定</h2>
              <div className="panel__body">
                <TodayTimeline />
              </div>
            </section>
          )}
          <section className={`panel panel--events${tab === 'calendar' ? ' panel--active' : ''}`}>
            <h2 className="panel__title">今後の予定</h2>
            <div className="panel__body">
              <CalendarPanel />
            </div>
          </section>
          {isWide && (
            <section className="panel panel--month">
              <h2 className="panel__title">カレンダー</h2>
              <div className="panel__body">
                <MonthCalendar />
              </div>
            </section>
          )}
          <section className={`panel panel--tasks${tab === 'tasks' ? ' panel--active' : ''}`}>
            <h2 className="panel__title">タスク</h2>
            <div className="panel__body">
              <TasksPanel />
            </div>
          </section>
          {isWide && (
            <section className="panel panel--weather">
              <h2 className="panel__title">天気</h2>
              <div className="panel__body">
                <WeatherPanel />
              </div>
            </section>
          )}
          <section className={`panel panel--gmail${tab === 'gmail' ? ' panel--active' : ''}`}>
            <h2 className="panel__title">メール</h2>
            <div className="panel__body">
              <GmailPanel />
            </div>
          </section>
        </div>
      </main>

      {/* スマホ用タブバー（画面下端固定）。PC では CSS で非表示。
          未読・期限切れ件数をバッジ表示（0 のタブには付けない）。 */}
      <nav className="tabbar" role="tablist" aria-label="表示切替">
        {TABS.map((t) => {
          const count = badges[t.key]
          // メールは最大20件取得なので、20件なら「以上かもしれない」意味で 20+ と表示する。
          const label = t.key === 'gmail' && count >= 20 ? '20+' : String(count)
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`tabbar__tab${tab === t.key ? ' tabbar__tab--active' : ''}`}
              onClick={() => selectTab(t.key)}
            >
              {t.label}
              {count > 0 && (
                <span className="tabbar__badge" aria-label={`${count}件`}>
                  {label}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
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
