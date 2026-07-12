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
    // エラー本文を可能な範囲で読み取ってメッセージに含める
    let detail = ''
    try {
      const body = await response.json()
      detail = body?.error?.message ?? ''
    } catch {
      // JSON でない場合は無視
    }
    throw new ApiError(response.status, detail || `APIエラー (${response.status})`)
  }

  // 204 No Content 等、本文が無い場合に備える
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}
