// メールの書き込み（既読化・アーカイブと、その Undo）の TanStack Query mutation。
//
// 設計方針はタスク/カレンダーと同じ（Fable 助言）:
// - すべて楽観的更新: onMutate でキャッシュを即書き換え → onError で巻き戻し → onSettled で invalidate。
// - onMutate では cancelQueries でポーリング中の取得を止め、楽観結果の上書きを防ぐ。
// - 一覧は「受信トレイ（未読を上・既読を下）」なので、
//   既読化/未読化は一覧内で unread フラグを切り替えて並べ直す（消さない）。
//   アーカイブは受信トレイから外れるので一覧から除去し、Undo（アーカイブ解除）で戻す。
// - 認証切れ(401)・権限不足(403)の書き込みエラーは queryClient の MutationCache が一括処理する。

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  archiveMessage,
  markMessageRead,
  markMessageUnread,
  unarchiveMessage,
} from './api'
import type { GmailMessage } from './api'

// 受信トレイクエリのキー（useGmail と一致させる）。
const GMAIL_KEY = ['gmail', 'inbox'] as const

// 未読を上・既読を下、各グループ内は受信時刻の新しい順に並べ替える。
function orderInbox(list: GmailMessage[]): GmailMessage[] {
  return [...list].sort((a, b) =>
    a.unread === b.unread ? b.dateMs - a.dateMs : a.unread ? -1 : 1,
  )
}

// 一覧内の1件の未読フラグを切り替えて並べ直す（既読化 / 未読化）。
function setUnreadFlag(qc: ReturnType<typeof useQueryClient>, id: string, unread: boolean) {
  const prev = qc.getQueryData<GmailMessage[]>(GMAIL_KEY)
  qc.setQueryData<GmailMessage[]>(GMAIL_KEY, (old) =>
    orderInbox((old ?? []).map((m) => (m.id === id ? { ...m, unread } : m))),
  )
  return prev
}

// 一覧からメールを1件除去する（アーカイブ）。
function removeFromList(qc: ReturnType<typeof useQueryClient>, id: string) {
  const prev = qc.getQueryData<GmailMessage[]>(GMAIL_KEY)
  qc.setQueryData<GmailMessage[]>(GMAIL_KEY, (old) => (old ?? []).filter((m) => m.id !== id))
  return prev
}

// 一覧へメールを1件戻し、未読/既読・受信時刻の順に並べ直す（アーカイブ解除の Undo 用）。
function restoreToList(qc: ReturnType<typeof useQueryClient>, msg: GmailMessage) {
  const prev = qc.getQueryData<GmailMessage[]>(GMAIL_KEY)
  qc.setQueryData<GmailMessage[]>(GMAIL_KEY, (old) =>
    orderInbox([...(old ?? []).filter((m) => m.id !== msg.id), msg]),
  )
  return prev
}

// 既読にする（一覧内で未読→既読にして既読セクションへ移す）。Undo は useMarkUnread。
export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (msg: GmailMessage) => markMessageRead(msg.id),
    onMutate: async (msg) => {
      await qc.cancelQueries({ queryKey: GMAIL_KEY })
      const prev = setUnreadFlag(qc, msg.id, false)
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(GMAIL_KEY, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: GMAIL_KEY })
    },
  })
}

// 未読に戻す（既読化の Undo、または既読メールを手動で未読化）。一覧内で既読→未読にして上へ移す。
export function useMarkUnread() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (msg: GmailMessage) => markMessageUnread(msg.id),
    onMutate: async (msg) => {
      await qc.cancelQueries({ queryKey: GMAIL_KEY })
      const prev = setUnreadFlag(qc, msg.id, true)
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(GMAIL_KEY, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: GMAIL_KEY })
    },
  })
}

// アーカイブする（受信トレイから外す＝一覧から即消す）。Undo は useUnarchive。
export function useArchive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (msg: GmailMessage) => archiveMessage(msg.id),
    onMutate: async (msg) => {
      await qc.cancelQueries({ queryKey: GMAIL_KEY })
      const prev = removeFromList(qc, msg.id)
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(GMAIL_KEY, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: GMAIL_KEY })
    },
  })
}

// アーカイブを取り消す（受信トレイへ戻す＝Undo）。消したメールを一覧へ戻す。
export function useUnarchive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (msg: GmailMessage) => unarchiveMessage(msg.id),
    onMutate: async (msg) => {
      await qc.cancelQueries({ queryKey: GMAIL_KEY })
      const prev = restoreToList(qc, msg)
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(GMAIL_KEY, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: GMAIL_KEY })
    },
  })
}
