// 受信トレイの未読メールを取得する TanStack Query フック。
// Gmail はこの端末で有効化されていて、かつ gmail.modify を同意済みのときだけ動かす。

import { useIsMutating, useQuery } from '@tanstack/react-query'
import { fetchInboxUnread } from './api'
import { useAuth } from '../../auth/useAuth'
import { SCOPES } from '../../config'

export function useGmail(deviceEnabled: boolean) {
  const { isConnected, needsReconnect, grantedScopes } = useAuth()
  const hasScope = grantedScopes.includes(SCOPES.gmailModify)
  // 自分の操作（既読化・アーカイブ等）の実行中はポーリングを止め、
  // 楽観的更新の結果がバックグラウンド取得で上書きされるのを防ぐ。
  const mutating = useIsMutating() > 0
  return useQuery({
    queryKey: ['gmail', 'inboxUnread'],
    queryFn: () => fetchInboxUnread(20),
    enabled: isConnected && !needsReconnect && deviceEnabled && hasScope,
    // 未読一覧はそう頻繁に変わらないので他パネルと同じ5分間隔にする。
    refetchInterval: mutating ? false : 5 * 60 * 1000,
  })
}
