import { useEffect, useState } from 'react'
import { SCOPES, isClientIdConfigured } from './config'
import {
  connect,
  hasPreviousCalendarGrant,
  hasToken,
  prepareAuth,
  restoreSession,
  trySilentConnect,
  useAuth,
} from './auth/useAuth'
import { desiredScopes } from './auth/scopes'
import { CalendarPanel } from './features/calendar/CalendarPanel'
import { TodayTimeline, TimelineHeading } from './features/calendar/TodayTimeline'
import { MonthCalendar } from './features/calendar/MonthCalendar'
import { TasksPanel } from './features/tasks/TasksPanel'
import { GmailPanel } from './features/gmail/GmailPanel'
import { NewsPanel } from './features/news/NewsPanel'
import { WeatherPanel } from './features/weather/WeatherPanel'
import { useIsFetching } from '@tanstack/react-query'
import { useMediaQuery, WIDE_QUERY } from './useMediaQuery'
import { useLastUpdated } from './useLastUpdated'
import { ErrorBoundary } from './ErrorBoundary'
import { useOverdueCount } from './features/tasks/useTasks'
import { useUnreadCount } from './features/gmail/useGmail'
import { useGmailEnabled } from './features/gmail/enabled'
import { SettingsModal } from './features/settings/SettingsModal'
import { queryClient } from './queryClient'
import { requestQuickAddFocus } from './features/tasks/quickAddFocus'
import { applyUpdate, useNeedRefresh } from './pwaUpdate'
import { gmailLink } from './features/gmail/gmailLink'
import { PanelLink } from './PanelLink'
import { handleTablistKeyDown } from './roving'

// ヘッダー中央に出す今日の日付（例:「2026年7月13日 (日)」）。
function formatHeaderDate(d: Date): string {
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 (${weekday})`
}

// 最終更新の時刻表示（時:分）。日付は当日前提の想定なので時刻だけ出す。
function formatUpdatedTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

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
  const { isConnected, needsReconnect, needsScope, grantedScopes } = useAuth()
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
  // データの最終更新時刻（各パネルの取得成功のうち一番新しいもの）。ヘッダー右に表示する。
  const lastUpdated = useLastUpdated()
  // 取得中のクエリ数（>0 なら更新ボタンを回転・無効化する）。
  const fetching = useIsFetching() > 0
  const gmailActive = useGmailEnabled() && grantedScopes.includes(SCOPES.gmailModify)
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
    // Gmail 有効端末では Gmail 込みのスコープで準備・サイレント認証する（desiredScopes）。
    prepareAuth(desiredScopes()).catch(() => {
      // 読み込み失敗はログイン/再接続の試行時にエラー表示するのでここでは握りつぶす
    })
    if (restoreSession()) {
      setInitializing(false)
      return
    }
    if (hasPreviousCalendarGrant()) {
      trySilentConnect(desiredScopes()).finally(() => setInitializing(false))
    } else {
      setInitializing(false)
    }
  }, [])

  // PC のキーボードショートカット（#7）: R=全データ更新 / "/"=タスクのクイック追加へフォーカス。
  // 入力中(input/textarea/select/contentEditable)・修飾キー併用・モーダル/シート表示中は無効。
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      if (document.querySelector('.sheet-backdrop, .modal-overlay')) return
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        queryClient.invalidateQueries() // 予定・タスク・メール等を再取得
      } else if (e.key === '/') {
        e.preventDefault()
        requestQuickAddFocus() // タスクのクイック追加入力へフォーカス
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleConnect = () => {
    setConnectError(null)
    setConnecting(true)
    // ⚠ requestToken 自体はこの同期フレーム内で走る（gisClient 実装）。
    // 再接続・追加同意・初回ログインの全入口でここを通る。Gmail 有効端末では Gmail 込みの
    // スコープを要求する（desiredScopes）。INITIAL_SCOPES 固定にすると Gmail 権限が抜けて
    // 403→needsScope で Tasks まで巻き添えに停止するため（既知の不具合の修正）。
    connect(desiredScopes())
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
          <code>src/config.ts</code> の <code>GOOGLE_CLIENT_ID</code>{' '}
          に発行済みのIDを設定してください。
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
        {/* タイトルバー中央に今日の日付を表示（左右の要素幅に依らず中央に置くため絶対配置）。 */}
        <div className="app__date">{formatHeaderDate(new Date())}</div>
        <div className="app__headerRight">
          {/* データの最終更新時刻（設定ボタンの左）。まだ何も取得できていなければ出さない。
              スマホでは「最終更新」の語を隠して時刻だけ出す（CSS の .app__updated-label）。 */}
          {lastUpdated > 0 && (
            <span className="app__updated" title="データの最終更新時刻">
              <span className="app__updated-label">最終更新 </span>
              {formatUpdatedTime(lastUpdated)}
            </span>
          )}
          {/* 手動更新ボタン（全データ再取得）。スマホでは R キーが無いので常設する（#51）。
              取得中は回転アイコン＋無効化。PC の R キーと同じ invalidateQueries を呼ぶ。 */}
          <button
            className={`app__refresh${fetching ? ' app__refresh--spinning' : ''}`}
            onClick={() => queryClient.invalidateQueries()}
            disabled={fetching}
            aria-label="データを更新"
            title="データを更新"
          >
            ↻
          </button>
          <ConnectionStatus
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
            - 960〜1339px（中間幅）: 予定・タスク・Gmail の3カラムリスト。
            - 1340px〜（密度型）: 段積み3カラム。ここでだけ新規の読み取り専用部品を追加描画する。
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
              <TimelineHeading />
              <div className="panel__body">
                <ErrorBoundary label="今日の予定">
                  <TodayTimeline />
                </ErrorBoundary>
              </div>
            </section>
          )}
          <section
            id="panel-calendar"
            role="tabpanel"
            aria-labelledby="tab-calendar"
            className={`panel panel--events${tab === 'calendar' ? ' panel--active' : ''}`}
          >
            {/* 見出し「今後の予定」は「＋予定」ボタンと同じ行にするため CalendarPanel 内で描画する */}
            <div className="panel__body">
              <ErrorBoundary label="予定">
                <CalendarPanel />
              </ErrorBoundary>
            </div>
          </section>
          {isWide && (
            <section className="panel panel--month">
              <div className="panel__head">
                <h2 className="panel__title">カレンダー</h2>
                <PanelLink href="https://calendar.google.com/" label="Google カレンダーを開く" />
              </div>
              <div className="panel__body">
                <ErrorBoundary label="カレンダー">
                  <MonthCalendar />
                </ErrorBoundary>
              </div>
            </section>
          )}
          <section
            id="panel-tasks"
            role="tabpanel"
            aria-labelledby="tab-tasks"
            className={`panel panel--tasks${tab === 'tasks' ? ' panel--active' : ''}`}
          >
            <div className="panel__head">
              <h2 className="panel__title">タスク</h2>
              <PanelLink href="https://tasks.google.com/" label="Google タスクを開く" />
            </div>
            <div className="panel__body">
              <ErrorBoundary label="タスク">
                <TasksPanel />
              </ErrorBoundary>
            </div>
          </section>
          {isWide && (
            <section className="panel panel--weather">
              <h2 className="panel__title">天気</h2>
              <div className="panel__body">
                <ErrorBoundary label="天気">
                  <WeatherPanel />
                </ErrorBoundary>
              </div>
            </section>
          )}
          {/* メール（Gmail）を表示している端末は Gmail パネル、非表示の端末は代わりにニュースパネルを
              同じ枠に出す（空の「有効化」パネルが画面を占めるのを避けるため・#16 の A 案）。
              Gmail の再表示は設定（⚙）の「メール（Gmail）を表示」から。 */}
          <section
            id="panel-gmail"
            role="tabpanel"
            aria-labelledby="tab-gmail"
            className={`panel panel--gmail${tab === 'gmail' ? ' panel--active' : ''}`}
          >
            <div className="panel__head">
              <h2 className="panel__title">{gmailActive ? 'メール' : 'ニュース'}</h2>
              {gmailActive && <PanelLink {...gmailLink()} label="Gmail を開く" />}
            </div>
            <div className="panel__body">
              <ErrorBoundary label={gmailActive ? 'メール' : 'ニュース'}>
                {gmailActive ? <GmailPanel /> : <NewsPanel />}
              </ErrorBoundary>
            </div>
          </section>
        </div>
      </main>

      {/* スマホ用タブバー（画面下端固定）。PC では CSS で非表示。
          未読・期限切れ件数をバッジ表示（0 のタブには付けない）。 */}
      <nav
        className="tabbar"
        role="tablist"
        aria-label="表示切替"
        onKeyDown={(e) =>
          handleTablistKeyDown(
            e,
            TABS.map((t) => t.key),
            tab,
            selectTab,
          )
        }
      >
        {TABS.map((t) => {
          const count = badges[t.key]
          // メールは最大20件取得なので、20件なら「以上かもしれない」意味で 20+ と表示する。
          const label = t.key === 'gmail' && count >= 20 ? '20+' : String(count)
          // メール非表示の端末では、メールタブの枠にニュースを出すのでタブ名も「ニュース」にする。
          const tabName = t.key === 'gmail' && !gmailActive ? 'ニュース' : t.label
          const active = tab === t.key
          return (
            <button
              key={t.key}
              id={`tab-${t.key}`}
              data-tabkey={t.key}
              role="tab"
              aria-selected={active}
              aria-controls={`panel-${t.key}`}
              // roving tabindex: 選択中タブだけキーボードのタブ順に入れ、他は矢印キーで移動する。
              tabIndex={active ? 0 : -1}
              className={`tabbar__tab${active ? ' tabbar__tab--active' : ''}`}
              onClick={() => selectTab(t.key)}
            >
              {tabName}
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
      <UpdateToast />
    </div>
  )
}

// 新しいバージョンが用意できたときだけ、画面上部に「更新があります・再読み込み」を出す（#15）。
function UpdateToast() {
  const needRefresh = useNeedRefresh()
  if (!needRefresh) return null
  return (
    <div className="update-toast" role="status" aria-live="polite">
      <span className="update-toast__text">新しいバージョンがあります</span>
      <button className="update-toast__action" onClick={applyUpdate}>
        再読み込み
      </button>
    </div>
  )
}

// 再接続が必要なときだけ「再接続」ボタンを表示する。通常時は何も出さない。
function ConnectionStatus({
  needsReconnect,
  connecting,
  onReconnect,
}: {
  needsReconnect: boolean
  connecting: boolean
  onReconnect: () => void
}) {
  if (!needsReconnect) return null
  return (
    <button className="btn btn--small" onClick={onReconnect} disabled={connecting}>
      再接続
    </button>
  )
}
