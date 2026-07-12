// React から認証状態を購読し、ログイン操作を提供するフック。
//
// GIS の制約により、トークン要求は必ずユーザーのクリックハンドラから同期的に呼ぶ必要がある。
// connect() は Promise を返すが、内部の requestToken() 呼び出し自体はクリックの同期フレーム内で
// 走る（gisClient 側の実装でポップアップブロックを回避している）。

import { useSyncExternalStore } from 'react'
import { SCOPES } from '../config'
import { getAcquiredAt, getToken, loadGrantedScopes } from './tokenStore'
import { getSnapshot, markConnected, subscribe, type AuthSnapshot } from './authStore'
import { prepareTokenClient, requestToken, requestTokenSilent } from './gisClient'

export function useAuth(): AuthSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot)
}

// 指定スコープでログイン（初回接続 or 再接続 or 段階的認可の追加同意）を行う。
// クリックハンドラから呼ぶこと。
export async function connect(scopes: string[]): Promise<void> {
  const token = await requestToken(scopes)
  // requestToken 成功時点で tokenStore へ保存済み。UI状態を更新する。
  if (token) {
    // 実際に許可されたスコープは gisClient 側で addGrantedScopes 済みなので読み直す
    markConnected(loadGrantedScopes(), getAcquiredAt() ?? Date.now())
  }
}

// GIS スクリプトとトークンクライアントを事前準備する（アプリ起動時に一度呼ぶ）。
// これによりクリック時に同期的に requestAccessToken() を呼べる。
export async function prepareAuth(scopes: string[]): Promise<void> {
  await prepareTokenClient(scopes)
}

// 以前この端末でカレンダーに同意済みか（＝起動時サイレント認証を試す価値があるか）。
export function hasPreviousCalendarGrant(): boolean {
  return loadGrantedScopes().includes(SCOPES.calendarEvents)
}

// sessionStorage から復元した有効なトークンがあれば、それで即座に接続済みにする。
// ページ更新時の再ログインを不要にするための主経路。復元できたら true を返す。
export function restoreSession(): boolean {
  if (getToken()) {
    markConnected(loadGrantedScopes(), getAcquiredAt() ?? Date.now())
    return true
  }
  return false
}

// 起動時のサイレント（ポップアップ無し）ログインを試みる。
// 成功すれば true を返して接続済み状態にする。失敗（セッション切れ・未同意・
// タイムアウト）なら false を返し、呼び出し側は通常のウェルカム画面に倒す。
export async function trySilentConnect(scopes: string[]): Promise<boolean> {
  try {
    await prepareTokenClient(scopes)
    const token = await requestTokenSilent(scopes)
    if (token) {
      markConnected(loadGrantedScopes(), getAcquiredAt() ?? Date.now())
      return true
    }
    return false
  } catch {
    // セッション切れ等。静かに未接続へフォールバック（エラーは表示しない）
    return false
  }
}

// 現在有効なトークンを持っているか（レンダリング外からの簡易チェック用）。
export function hasToken(): boolean {
  return getToken() !== null
}
