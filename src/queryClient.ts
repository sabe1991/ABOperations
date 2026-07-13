// TanStack Query のクライアント設定。
// モジュールレベルで1つだけ生成する（コンポーネント内で作らない）。
//
// 401（認証切れ）の処理は QueryCache のグローバル onError で一括して行う（Fable 助言）。
// 個々の useQuery に 401 ハンドリングを書かない。フロー:
//   fetchJson が 401 で AuthError を throw
//     → onError が AuthError を検知して authStore.markExpired()
//     → 各クエリは enabled:false で自動停止、再接続ボタン表示
//     → 再接続成功で needsReconnect=false に戻ると enabled が復活して自動再取得

import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { AuthError, ScopeError } from './google/fetchJson'
import { markExpired, markNeedsScope } from './auth/authStore'

// 認証系エラーを一元処理する。401=再接続、403権限不足=追加同意へ振り分ける。
function handleAuthError(error: unknown): void {
  if (error instanceof AuthError) {
    markExpired()
  } else if (error instanceof ScopeError) {
    // needsScope は「追加の許可」バナー＋Tasks/カレンダーの停止を意味するグローバル状態。
    // Gmail は端末ごとに enabled かつ gmail.modify 同意済みのときだけ取得するよう別途
    // ゲートしているので、Gmail の 403 でこのフラグを立てると Tasks まで巻き添えで止まる。
    // よって Gmail エンドポイント由来の 403 では needsScope を立てない（Gmail 側の
    // クエリエラー表示に委ねる）。Tasks/カレンダー由来の 403 のみ追加同意へ誘導する。
    if (!isGmailUrl(error.url)) markNeedsScope()
  }
}

function isGmailUrl(url: string | undefined): boolean {
  return !!url && url.includes('gmail.googleapis.com')
}

// 明示的に QueryClient 型を注釈する。refetchOnWindowFocus の関数内で queryClient 自身を
// 参照するため、型注釈が無いと「自身の初期化子で自身を参照している」で implicit any になる。
export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleAuthError,
  }),
  // 書き込み(mutation)のエラーは QueryCache.onError を通らない。
  // トークン失効/権限不足で完了・追加した場合も同じUXへ流すため、こちらにも同じハンドラを置く（Fable 助言）。
  mutationCache: new MutationCache({
    onError: handleAuthError,
  }),
  defaultOptions: {
    queries: {
      // 認証切れ(AuthError)・権限不足(ScopeError)はリトライしても無駄なので再試行しない。
      // それ以外（ネットワーク等）は最大2回まで再試行する。
      retry: (failureCount, error) => {
        if (error instanceof AuthError || error instanceof ScopeError) return false
        return failureCount < 2
      },
      // 画面復帰時の再取得は既定で有効（visibilitychange 相当）。
      // ただし書き込み(mutation)の実行中は抑止する。楽観更新でUIを先に書き換えている最中に
      // 画面復帰の再取得が走ると、サーバー未反映の古いデータで一瞬上書きされてちらつくため（#33）。
      // 関数を渡すと再取得の判定時に評価される（この時点では queryClient は初期化済み）。
      refetchOnWindowFocus: (): boolean => queryClient.isMutating() === 0,
      // 取得済みデータを5分間は新鮮とみなす
      staleTime: 5 * 60 * 1000,
    },
  },
})
