// アクセストークン（Google API を呼ぶための一時的な通行証）の保管庫。
//
// 設計方針（Fable 助言）:
// - トークンは React の再レンダリングに関与させたくない「生データ」なので、
//   Context ではなくモジュールレベルのシングルトン（アプリ内に1つだけの変数）で持つ。
// - localStorage には永続保存しない（XSS＝悪意あるスクリプト混入時の漏洩対策。
//   どのみち1時間で失効するので永続化の利点も小さい）。メモリ保持を基本とする。
// - どのスコープ（権限）を同意済みかは「トークンではない」ので localStorage に
//   記録してよい。次回起動時の UX（どのパネルが使えるか）をなめらかにするため。

let accessToken: string | null = null
// トークンを取得した時刻（ミリ秒）。再ログイン頻度を実機検証するため画面に表示する。
let acquiredAt: number | null = null

export function getToken(): string | null {
  return accessToken
}

export function getAcquiredAt(): number | null {
  return acquiredAt
}

export function setToken(token: string, nowMs: number): void {
  accessToken = token
  acquiredAt = nowMs
}

export function clearToken(): void {
  accessToken = null
  acquiredAt = null
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
