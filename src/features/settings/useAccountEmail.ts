// ログイン中の Google アカウント（メールアドレス）を取得するフック。
//
// 追加スコープ無しで取れる方法を採る（Fable 方針の踏襲）: カレンダーの「primary（主）
// カレンダー」の id はそのアカウントのメールアドレスそのものなので、既に同意済みの
// カレンダー権限だけで判明する。userinfo 用の openid/email スコープは要求しない。
//
// 取得は専用エンドポイントではなく、全機能で共有するカレンダー一覧クエリ（['calendar','list']）を
// select で絞って primary の id を取り出す。これで calendarList の二重取得を無くす（#32）。

import { useQuery } from '@tanstack/react-query'
import { fetchCalendarList, primaryEmail } from '../calendar/api'
import { useAuth } from '../../auth/useAuth'

export function useAccountEmail() {
  const { isConnected, needsReconnect } = useAuth()
  return useQuery({
    queryKey: ['calendar', 'list'],
    queryFn: fetchCalendarList,
    enabled: isConnected && !needsReconnect,
    // カレンダー構成はあまり変わらないので長めに保持（useCalendarList と同じ設定にそろえる）。
    staleTime: 30 * 60 * 1000,
    select: primaryEmail,
  })
}
