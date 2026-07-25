// パネルの表示を守る共通のエラー UI。2種類のエラーを同じ見た目で扱う:
//   1. 取得エラー（TanStack Query の isError）… PanelError で「再試行」ボタン付きで表示する。
//   2. 描画時の例外（想定外レスポンスでのクラッシュ等）… ErrorBoundary が捕捉し、
//      アプリ全体を白画面にせず、その欄だけフォールバック表示にする。
// どちらも `panel__note panel__note--error` の枠を使い、境界エラーとクエリエラーで
// 見た目が食い違わないようにする（Fable 助言）。

import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { toUserMessage } from './errorMessage'
import { AuthError } from './google/fetchJson'

// 取得エラーの表示（再試行ボタン付き）。各パネルの isError 分岐から使う。
// message は「予定の取得に失敗しました」等の日本語プレフィックス。
export function PanelError({
  message,
  error,
  onRetry,
}: {
  message: string
  error?: unknown
  onRetry?: () => void
}) {
  // 認証切れ(401)だけは特別扱いする。この状態では画面上部に「接続が切れました。＋再接続」
  // バナーが必ず出ており（AuthError は queryClient の onError で markExpired を呼ぶため）、
  // 各カードにも「再試行」を出すとボタンが画面に何個も並ぶ。しかもトークンを失っている以上
  // 再試行は必ず同じ 401 になり、復帰できるのは「再接続」だけなので押させる意味がない。
  // よってここでは案内文だけを短く出し、操作はバナーに一本化する。
  if (error instanceof AuthError) {
    return (
      <div className="panel__note panel__note--error" role="alert">
        <span>接続が切れています。上部の「再接続」から再開してください。</span>
      </div>
    )
  }
  return (
    <div className="panel__note panel__note--error" role="alert">
      <span>
        {message}
        {error != null && `: ${toUserMessage(error)}`}
      </span>
      {onRetry && (
        <button className="btn btn--small panel__retry" onClick={onRetry}>
          再試行
        </button>
      )}
    </div>
  )
}

// 描画時の例外を捕捉して、その欄だけフォールバック表示にするエラーバウンダリ。
// resetKeys を渡すと、その値が変わったとき自動でエラー状態を解除して再描画を試みる。
export class ErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 開発時の切り分け用にコンソールへ残す（ユーザー向け表示は下のフォールバック）。
    console.error('パネルの描画でエラーが発生しました', error, info)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="panel__note panel__note--error" role="alert">
          <span>
            {this.props.label ? `${this.props.label}の表示中に問題が発生しました。` : 'この欄の表示中に問題が発生しました。'}
          </span>
          <span className="panel__error-actions">
            {/* まず状態を解除して再描画（一時的な不整合なら復帰する）。だめならページ全体を再読込。 */}
            <button className="btn btn--small" onClick={() => this.setState({ hasError: false })}>
              再試行
            </button>
            <button className="btn btn--small" onClick={() => window.location.reload()}>
              再読込
            </button>
          </span>
        </div>
      )
    }
    return this.props.children
  }
}
