// 認証まわりの「UI に見せる状態」を保持する外部ストア。
//
// tokenStore（生のアクセストークン）とは責務を分ける:
//   - tokenStore … 秘密の生データ。React に関与させない。
//   - authStore  … 「ログイン済みか」「再接続が必要か」等の boolean 級のUI状態。
//                   React から useSyncExternalStore で購読する。
//
// このストアは gisClient のコールバック経路（ログイン成功）からも、
// QueryCache の onError（401検知）からも更新される。両者が同じ真実を見るための一元管理点。

import { clearToken, loadGrantedScopes } from './tokenStore'
import { INITIAL_SCOPES } from '../config'

export type AuthSnapshot = {
  // ログイン済みで有効なトークンを持っているか
  isConnected: boolean
  // 401で認証が切れ、再接続ボタンを出すべき状態か
  needsReconnect: boolean
  // トークンは有効だが、今アプリが必要とする権限（スコープ）が一部欠けている状態。
  // 例: タスク機能を追加する前の「カレンダーだけ」の許可のまま使い続けている端末。
  // このとき「追加の許可」を促すバナーを出す（再ログインではなく段階的認可）。
  needsScope: boolean
  // これまでに同意済みのスコープ（段階的認可でどのパネルが使えるかの判定用）
  grantedScopes: string[]
  // トークンを取得した時刻（ミリ秒）。再ログイン頻度の実機検証用に画面表示する。
  acquiredAt: number | null
}

// 今アプリが必要とするスコープ（INITIAL_SCOPES）のうち、まだ同意されていないものがあるか。
function isMissingScopes(granted: string[]): boolean {
  return INITIAL_SCOPES.some((s) => !granted.includes(s))
}

// useSyncExternalStore は getSnapshot が「安定した参照」を返すことを要求するため、
// 変更のたびにオブジェクトを丸ごと差し替える（同一参照を返し続ける）方式にする。
let snapshot: AuthSnapshot = {
  isConnected: false,
  needsReconnect: false,
  needsScope: false,
  grantedScopes: loadGrantedScopes(),
  acquiredAt: null,
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot(): AuthSnapshot {
  return snapshot
}

// ログイン成功時に呼ぶ。
// 同意済みスコープに不足があれば needsScope を立てて追加同意を促す（Android の
// 「タスク追加前の古い許可のまま」等を、実際に API が失敗する前に検知する）。
export function markConnected(grantedScopes: string[], acquiredAt: number): void {
  snapshot = {
    isConnected: true,
    needsReconnect: false,
    needsScope: isMissingScopes(grantedScopes),
    grantedScopes,
    acquiredAt,
  }
  emit()
}

// 401検知時に呼ぶ。トークンを破棄し、再接続を促す状態にする。
// grantedScopes は同意の記録なので保持したまま（再接続で同じ同意画面をくぐる）。
export function markExpired(): void {
  clearToken()
  snapshot = {
    ...snapshot,
    isConnected: false,
    needsReconnect: true,
    needsScope: false,
    acquiredAt: null,
  }
  emit()
}

// 権限不足（403 insufficient_scope）検知時に呼ぶ。トークン自体は有効なので破棄せず、
// 「追加の許可が必要」バナーだけを出す（カレンダー等の許可済み機能はそのまま使える）。
// localStorage の同意記録が古い/欠落していても、実際の API 失敗を根拠に確実に検知できる。
export function markNeedsScope(): void {
  if (snapshot.needsScope) return
  snapshot = {
    ...snapshot,
    needsScope: true,
  }
  emit()
}
