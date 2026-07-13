// Google API 呼び出しの共通ラッパー。
// アクセストークンを Authorization ヘッダに付け、401（認証切れ）を専用エラーにして投げる。
//
// 401 の一括処理は TanStack Query の QueryCache グローバル onError で行うため（Fable 助言）、
// ここでは「401 なら AuthError を throw する」ことだけに責務を絞る。

import { getToken } from '../auth/tokenStore'

// 認証切れ（401）を表す専用エラー。QueryCache 側でこの型を見て再接続 UX に切り替える。
export class AuthError extends Error {
  constructor(message = '認証の有効期限が切れました') {
    super(message)
    this.name = 'AuthError'
  }
}

// API がエラー応答を返したとき用の一般エラー。
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// 権限不足（403 insufficient_scope）を表す専用エラー。
// トークンは有効だが、その機能に必要なスコープ（権限）が同意されていない状態。
// 例: カレンダーだけ同意済みのトークンで Tasks API を叩いたとき。
// 認証切れ(401)とは別物なので、再ログインではなく「不足スコープの追加同意」へ誘導する。
export class ScopeError extends Error {
  // どのエンドポイントで権限不足になったか（呼び出し先の URL）。
  // どの機能(Tasks/Gmail 等)の 403 かを呼び出し側で見分けるために持つ。
  url?: string
  constructor(message = 'この機能に必要な権限が許可されていません', url?: string) {
    super(message)
    this.name = 'ScopeError'
    this.url = url
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  if (!token) {
    // トークンが無い状態での呼び出しは認証切れ扱い（再接続を促す）
    throw new AuthError('ログインが必要です')
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  })

  if (response.status === 401) {
    throw new AuthError()
  }

  if (!response.ok) {
    // エラー本文を可能な範囲で読み取ってメッセージに含める（本文は一度しか読めないので text で受ける）
    let detail = ''
    let raw = ''
    try {
      raw = await response.text()
      const body = JSON.parse(raw)
      detail = body?.error?.message ?? ''
    } catch {
      // JSON でない場合は無視
    }

    // 403 のうち「権限不足」だけは ScopeError として区別する。
    // Google API は不足時にレスポンスヘッダ WWW-Authenticate に error="insufficient_scope" を、
    // 本文に ACCESS_TOKEN_SCOPE_INSUFFICIENT を返す。どちらかを検出したら追加同意へ誘導。
    if (response.status === 403) {
      const wwwAuth = response.headers.get('WWW-Authenticate') ?? ''
      if (/insufficient_scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(`${wwwAuth} ${raw}`)) {
        throw new ScopeError(undefined, url)
      }
    }

    throw new ApiError(response.status, detail || `APIエラー (${response.status})`)
  }

  // 本文を読む。204 No Content や、200 でも本文が空のケース（delete 等）に備え、
  // 空なら undefined を返す。空ボディに response.json() を呼ぶと SyntaxError で落ちるため、
  // いったん text で受けてから JSON 解析する（#64）。値を使わない delete/complete 系の
  // ミューテーションは戻り値を参照しないので undefined でよい（型上は T として返す）。
  const body = await response.text()
  if (body === '') {
    return undefined as T
  }
  return JSON.parse(body) as T
}
