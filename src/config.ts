// アプリ全体の設定値。
//
// OAuth クライアントID はクライアントサイド OAuth では「公開前提」の値であり、
// 秘密情報ではない（GitHub Secrets 等での管理は不要。リポジトリ直書きでよい）。
// フェーズ2の Google Cloud セットアップで発行したクライアントIDをここに貼り付ける。
//
// ⚠ 未設定（プレースホルダのまま）だと、ログイン時にセットアップ手順を促すメッセージを表示する。
export const GOOGLE_CLIENT_ID =
  '365972900643-36h2a4avt3fd8moh0je659d2j5jubh4c.apps.googleusercontent.com'

// クライアントIDがまだ設定されていない（プレースホルダのまま）かどうか。
export const isClientIdConfigured = !GOOGLE_CLIENT_ID.startsWith('PASTE_')

// OAuth スコープ（アプリがユーザーに求める権限の範囲）。
// 段階的認可のため、機能ごとにグループ分けしておく。
// 初回ログインではカレンダーのみ要求し、Tasks / Gmail は後のフェーズで追加同意する。
export const SCOPES = {
  // 予定の閲覧・作成・編集・削除
  calendarEvents: 'https://www.googleapis.com/auth/calendar.events',
  // カレンダー一覧（各カレンダーのID・名前・色）の読み取り
  calendarList: 'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  // Google Tasks（フェーズ3で使用）
  tasks: 'https://www.googleapis.com/auth/tasks',
  // Gmail 読取+既読化+アーカイブ+ゴミ箱移動（Gmailパネル有効化端末でのみ追加同意）
  gmailModify: 'https://www.googleapis.com/auth/gmail.modify',
} as const

// 初回ログインで要求するスコープ。段階的認可により、カレンダー + Tasks をまとめて同意する
// （PLAN: 初回は カレンダー+Tasks のみ。Gmail は後のフェーズで端末ごとに追加同意）。
export const INITIAL_SCOPES = [SCOPES.calendarEvents, SCOPES.calendarList, SCOPES.tasks]

// Gmail を有効化するときに要求するスコープ。既存の同意分もまとめて要求し（union）、
// 1本のトークンに全機能分を載せる。同意画面に出るのは未同意の Gmail 分だけ（増分認可）。
export const GMAIL_SCOPES = [...INITIAL_SCOPES, SCOPES.gmailModify]
