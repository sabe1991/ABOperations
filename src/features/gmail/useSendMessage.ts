// メール送信（新規作成・返信）の TanStack Query mutation（#4）。
// 送信結果は受信トレイ一覧を直接は変えない（送信メールは「送信済み」に入る）ため、
// 楽観的更新はしない。認証切れ(401)・権限不足(403)は queryClient の MutationCache が一括処理する。

import { useMutation } from '@tanstack/react-query'
import { sendMessage } from './compose'
import type { OutgoingMessage } from './compose'

export function useSendMessage() {
  return useMutation({
    mutationFn: (msg: OutgoingMessage) => sendMessage(msg),
  })
}
