// 1通のメール本文を取得する TanStack Query フック（本文プレビュー用）。
// 一覧と違い、開いたメールだけ都度取得する。id が null（未展開）の間は動かさない。

import { useQuery } from '@tanstack/react-query'
import { fetchMessageBody } from './api'

export function useMessageBody(id: string | null) {
  return useQuery({
    queryKey: ['gmail', 'body', id],
    queryFn: () => fetchMessageBody(id as string),
    enabled: !!id,
    // 同じメールを開き直しても再取得しないよう長めに保持（本文は基本変わらない）。
    staleTime: 10 * 60 * 1000,
  })
}
