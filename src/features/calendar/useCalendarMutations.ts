// カレンダー予定の書き込み（作成・編集・削除・削除Undo）の TanStack Query mutation。
//
// 設計方針（Fable 助言、Tasks 側と統一）:
// - 楽観的更新: onMutate でキャッシュを即書換 → onError で巻戻し → onSettled で invalidate。
// - onMutate では必ず cancelQueries でポーリング取得を中断（仮挿入がすぐ消えるのを防ぐ）。
// - 削除の Undo は「再作成」ではなく同じ event id に status:"confirmed" を PATCH（ID不変）。
//   単発・繰り返しインスタンスのどちらも同じ復元コードで戻せる。

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createEvent,
  deleteEvent,
  draftToLocalEvent,
  isWithinUpcomingWindow,
  restoreEvent,
  updateEvent,
  updateEventRecurrence,
} from './api'
import type { CalendarEvent, EventDraft } from './api'
import { buildRecurrence } from './recurrence'
import type { RecurrenceRule } from './recurrence'
import { tempId } from '../../tempId'

// 予定一覧クエリのキー（useCalendarEvents と一致させる）。
const CAL_KEY = ['calendar', 'upcoming'] as const

function bySortKey(a: CalendarEvent, b: CalendarEvent) {
  return a.startMs - b.startMs
}

// 実際に画面が購読するキーは ['calendar','upcoming', <カレンダー構成の署名>] の3要素（#54で署名を追加）。
// TanStack Query の setQueryData/getQueryData は「キー完全一致」でしか当たらないため、2要素の CAL_KEY へ
// 書くと誰も読まない“幽霊エントリ”に書き込んでしまい、楽観的更新が画面へ反映されない（確定が
// サーバー往復後の再取得まで遅れ、ドラッグ確定時に一瞬元位置へ戻って見える原因になっていた）。
// 前方一致で引ける getQueriesData で実エントリ（署名違いで複数あってもすべて）を取り、その実キーへ
// 書き換える。cancelQueries/invalidateQueries は元から前方一致なので CAL_KEY のままでよい。
type CalSnapshot = [readonly unknown[], CalendarEvent[] | undefined][]

function optimisticUpdate(
  qc: ReturnType<typeof useQueryClient>,
  update: (old: CalendarEvent[]) => CalendarEvent[],
): CalSnapshot {
  const entries = qc.getQueriesData<CalendarEvent[]>({ queryKey: CAL_KEY })
  for (const [key, old] of entries) {
    qc.setQueryData<CalendarEvent[]>(key, update(old ?? []))
  }
  return entries
}

// 楽観的更新の巻き戻し（onError）。optimisticUpdate が返したスナップショットを実キーへ書き戻す。
function rollback(qc: ReturnType<typeof useQueryClient>, snapshot: CalSnapshot) {
  for (const [key, prev] of snapshot) qc.setQueryData(key, prev)
}

// 予定を作成する。7日ウィンドウ内なら仮IDで一覧に即挿入し、確定後 invalidate で本物に置換。
// ウィンドウ外（8日目以降）は一覧に出ないので仮挿入しない（呼び出し側がトーストで通知）。
export function useCreateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { draft: EventDraft; calendarName: string; calendarColor: string }) =>
      createEvent(input.draft),
    onMutate: async ({ draft, calendarName, calendarColor }) => {
      await qc.cancelQueries({ queryKey: CAL_KEY })
      const temp = draftToLocalEvent(draft, tempId(), calendarName, calendarColor, {
        pending: true,
      })
      const prev = isWithinUpcomingWindow(temp.startMs)
        ? optimisticUpdate(qc, (old) => [...old, temp].sort(bySortKey))
        : qc.getQueriesData<CalendarEvent[]>({ queryKey: CAL_KEY })
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) rollback(qc, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CAL_KEY })
    },
  })
}

// 予定を編集する。時刻が変わると並び順も変わるので再ソートする。
export function useUpdateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ event, draft }: { event: CalendarEvent; draft: EventDraft }) =>
      updateEvent(draft.calendarId, event.id, draft),
    onMutate: async ({ event, draft }) => {
      await qc.cancelQueries({ queryKey: CAL_KEY })
      const updated = draftToLocalEvent(draft, event.id, event.calendarName, event.calendarColor, {
        isRecurringInstance: event.isRecurringInstance,
        writable: event.writable,
      })
      const prev = optimisticUpdate(qc, (old) =>
        old.map((e) => (e.id === event.id ? updated : e)).sort(bySortKey),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) rollback(qc, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CAL_KEY })
    },
  })
}

// 予定を削除する（一覧から即除去）。Undo は useRestoreEvent（status:"confirmed"）で戻す。
export function useDeleteEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (event: CalendarEvent) => deleteEvent(event.calendarId, event.id),
    onMutate: async (event) => {
      await qc.cancelQueries({ queryKey: CAL_KEY })
      const prev = optimisticUpdate(qc, (old) => old.filter((e) => e.id !== event.id))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) rollback(qc, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CAL_KEY })
    },
  })
}

// 繰り返しルール（毎週→隔週など）をシリーズ全体に対して変更する（#3）。
// マスター予定の recurrence を差し替える。展開後の各インスタンスが総入れ替えになるため
// 楽観的更新はせず、成功後にカレンダー系クエリ（一覧・月ドット）をまとめて invalidate する。
export function useUpdateRecurrence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      calendarId,
      masterEventId,
      rule,
      allDay,
    }: {
      calendarId: string
      masterEventId: string
      rule: RecurrenceRule
      allDay: boolean
    }) => updateEventRecurrence(calendarId, masterEventId, buildRecurrence(rule, allDay)),
    onSettled: (_data, _err, { calendarId, masterEventId }) => {
      // 一覧・月ドットはインスタンスが総入れ替えなので全カレンダー系を無効化。
      qc.invalidateQueries({ queryKey: ['calendar', 'upcoming'] })
      qc.invalidateQueries({ queryKey: ['calendar', 'monthDays'] })
      // 開いているルール取得キャッシュも更新する。
      qc.invalidateQueries({ queryKey: ['calendar', 'recurrence', calendarId, masterEventId] })
    },
  })
}

// 削除した予定を復元する（Undo）。消した予定を即座に一覧へ戻す。
export function useRestoreEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (event: CalendarEvent) => restoreEvent(event.calendarId, event.id),
    onMutate: async (event) => {
      await qc.cancelQueries({ queryKey: CAL_KEY })
      const prev = optimisticUpdate(qc, (old) => [...old, event].sort(bySortKey))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) rollback(qc, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CAL_KEY })
    },
  })
}
