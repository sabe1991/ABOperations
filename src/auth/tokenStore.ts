// アクセストークン（Google API を呼ぶための一時的な通行証）の保管庫。
//
// 設計方針:
// - トークンは React の再レンダリングに関与させたくない「生データ」なので、
//   Context ではなくモジュールレベルのシングルトン（アプリ内に1つだけの変数）で持つ。
// - 保存先は sessionStorage（ユーザー選択）。同じタブを開いている間はページ更新しても
//   トークンが復元されログインが維持される。タブを閉じると消えるため「端末に長期保存
//   しない」原則は概ね維持される（localStorage のようにブラウザ再起動後も残さない）。
//   どのみちトークンは約1時間で失効するので、それより短い TTL で期限切れを弾く。
// - どのスコープ（権限）を同意済みかは「トークンではない」ので localStorage に
//   記録してよい。次回起動時の UX（どのパネルが使えるか）をなめらかにするため。

const TOKEN_KEY = 'abops:token'
// 1時間失効に対する安全マージン。これを過ぎた保存トークンは使わず破棄する。
const TOKEN_TTL_MS = 55 * 60 * 1000

let accessToken: string | null = null
// トークンを取得した時刻（ミリ秒）。再ログイン頻度の目安として画面に表示する。
let acquiredAt: number | null = null

// モジュール読み込み時に sessionStorage から復元する。
// ページ更新でメモリ変数が消えても、失効前ならログインを維持できる。
;(function hydrateFromSession() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { token?: unknown; at?: unknown }
    if (
      typeof parsed.token === 'string' &&
      typeof parsed.at === 'number' &&
      Date.now() - parsed.at < TOKEN_TTL_MS
    ) {
      accessToken = parsed.token
      acquiredAt = parsed.at
    } else {
      sessionStorage.removeItem(TOKEN_KEY)
    }
  } catch {
    // sessionStorage が使えない/壊れている場合はメモリのみで動作
  }
})()

export function getToken(): string | null {
  return accessToken
}

export function getAcquiredAt(): number | null {
  return acquiredAt
}

export function setToken(token: string, nowMs: number): void {
  accessToken = token
  acquiredAt = nowMs
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, at: nowMs }))
  } catch {
    // 保存できなくてもメモリ上のトークンで動作は継続する
  }
}

export function clearToken(): void {
  accessToken = null
  acquiredAt = null
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}

// ---- 同意済みスコープの記録（localStorage、トークンではないので永続化OK）----

const GRANTED_SCOPES_KEY = 'abops:grantedScopes'

export function loadGrantedScopes(): string[] {
  try {
    const raw = localStorage.getItem(GRANTED_SCOPES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function addGrantedScopes(scopes: string[]): string[] {
  const merged = Array.from(new Set([...loadGrantedScopes(), ...scopes]))
  try {
    localStorage.setItem(GRANTED_SCOPES_KEY, JSON.stringify(merged))
  } catch {
    // localStorage が使えない環境（プライベートモード等）でも致命的ではない
  }
  return merged
}
