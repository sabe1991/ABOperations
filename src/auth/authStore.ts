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

export type AuthSnapshot = {
  // ログイン済みで有効なトークンを持っているか
  isConnected: boolean
  // 401で認証が切れ、再接続ボタンを出すべき状態か
  needsReconnect: boolean
  // これまでに同意済みのスコープ（段階的認可でどのパネルが使えるかの判定用）
  grantedScopes: string[]
  // トークンを取得した時刻（ミリ秒）。再ログイン頻度の実機検証用に画面表示する。
  acquiredAt: number | null
}

// useSyncExternalStore は getSnapshot が「安定した参照」を返すことを要求するため、
// 変更のたびにオブジェクトを丸ごと差し替える（同一参照を返し続ける）方式にする。
let snapshot: AuthSnapshot = {
  isConnected: false,
  needsReconnect: false,
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
export function markConnected(grantedScopes: string[], acquiredAt: number): void {
  snapshot = {
    isConnected: true,
    needsReconnect: false,
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
    acquiredAt: null,
  }
  emit()
}
