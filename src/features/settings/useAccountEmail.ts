// ログイン中の Google アカウント（メールアドレス）を取得するフック。
//
// 追加スコープ無しで取れる方法を採る（Fable 方針の踏襲）: カレンダーの「primary（主）
// カレンダー」の id はそのアカウントのメールアドレスそのものなので、既に同意済みの
// カレンダー権限だけで判明する。userinfo 用の openid/email スコープは要求しない。

import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '../../google/fetchJson'
import { useAuth } from '../../auth/useAuth'

const CAL_BASE = 'https://www.googleapis.com/calendar/v3'

async function fetchAccountEmail(): Promise<string> {
  const res = await fetchJson<{ id?: string }>(`${CAL_BASE}/users/me/calendarList/primary`)
  return res.id ?? ''
}

export function useAccountEmail() {
  const { isConnected, needsReconnect } = useAuth()
  return useQuery({
    queryKey: ['account', 'email'],
    queryFn: fetchAccountEmail,
    enabled: isConnected && !needsReconnect,
    // アカウントは基本変わらないので長めに保持（再取得はほぼ不要）。
    staleTime: 60 * 60 * 1000,
  })
}
