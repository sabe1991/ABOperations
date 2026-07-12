// 受信トレイのメール（未読＋既読）を取得する TanStack Query フック。
// Gmail はこの端末で有効化されていて、かつ gmail.modify を同意済みのときだけ動かす。

import { useIsMutating, useQuery } from '@tanstack/react-query'
import { fetchInbox } from './api'
import { useAuth } from '../../auth/useAuth'
import { SCOPES } from '../../config'

export function useGmail(deviceEnabled: boolean) {
  const { isConnected, needsReconnect, grantedScopes } = useAuth()
  const hasScope = grantedScopes.includes(SCOPES.gmailModify)
  // 自分の操作（既読化・アーカイブ等）の実行中はポーリングを止め、
  // 楽観的更新の結果がバックグラウンド取得で上書きされるのを防ぐ。
  const mutating = useIsMutating() > 0
  return useQuery({
    queryKey: ['gmail', 'inbox'],
    queryFn: () => fetchInbox(),
    enabled: isConnected && !needsReconnect && deviceEnabled && hasScope,
    // 受信トレイはそう頻繁に変わらないので他パネルと同じ5分間隔にする。
    refetchInterval: mutating ? false : 5 * 60 * 1000,
  })
}

// タブのバッジ用: 未読メールの件数だけを返す（Fable 助言）。
// useGmail と同じ queryKey なので取得は重複しない。一覧は未読を最大20件取得なので、
// 20件以上あるときは "20+" 相当（呼び出し側で表示を丸める）。
export function useUnreadCount(deviceEnabled: boolean): number {
  const { isConnected, needsReconnect, grantedScopes } = useAuth()
  const hasScope = grantedScopes.includes(SCOPES.gmailModify)
  return (
    useQuery({
      queryKey: ['gmail', 'inbox'],
      queryFn: () => fetchInbox(),
      enabled: isConnected && !needsReconnect && deviceEnabled && hasScope,
      // 一覧には既読も含まれるので、バッジは未読だけ数える。
      select: (messages) => messages.filter((m) => m.unread).length,
    }).data ?? 0
  )
}
