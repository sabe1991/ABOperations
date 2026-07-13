// 例外をユーザー向けの短い日本語メッセージへ変換する（#28）。
// 生の例外文字列（"TypeError: Failed to fetch"、"[object Object]" 等）をそのまま画面に出さず、
// 原因と次の一手が伝わる定型文にする。技術的な詳細はコンソール（console.error）に委ねる。

import { ApiError, AuthError, ScopeError } from './google/fetchJson'

export function toUserMessage(error: unknown): string {
  if (error instanceof AuthError) {
    return 'ログインの有効期限が切れました。再接続してください。'
  }
  if (error instanceof ScopeError) {
    return 'この操作に必要な許可が足りません。設定から許可を追加してください。'
  }
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return 'サーバー側で一時的な問題が発生しました。時間をおいて再試行してください。'
    }
    if (error.status === 429) {
      return 'アクセスが集中しているようです。少し待ってから再試行してください。'
    }
    return `取得に失敗しました（エラー ${error.status}）。時間をおいて再試行してください。`
  }
  // タイムアウト（AbortController で中断されたフェッチ）。
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '時間内に応答がありませんでした。通信状況を確認して再試行してください。'
  }
  // ネットワーク断など（fetch は失敗時に TypeError を投げる）。
  if (error instanceof TypeError) {
    return 'ネットワークに接続できませんでした。通信状況を確認してください。'
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return '不明なエラーが発生しました。時間をおいて再試行してください。'
}
