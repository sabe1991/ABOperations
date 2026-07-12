// React から認証状態を購読し、ログイン操作を提供するフック。
//
// GIS の制約により、トークン要求は必ずユーザーのクリックハンドラから同期的に呼ぶ必要がある。
// connect() は Promise を返すが、内部の requestToken() 呼び出し自体はクリックの同期フレーム内で
// 走る（gisClient 側の実装でポップアップブロックを回避している）。

import { useSyncExternalStore } from 'react'
import { getAcquiredAt, getToken, loadGrantedScopes } from './tokenStore'
import { getSnapshot, markConnected, subscribe, type AuthSnapshot } from './authStore'
import { prepareTokenClient, requestToken } from './gisClient'

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

// 現在有効なトークンを持っているか（レンダリング外からの簡易チェック用）。
export function hasToken(): boolean {
  return getToken() !== null
}
