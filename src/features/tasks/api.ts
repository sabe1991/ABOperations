// Google Tasks API の呼び出し。
// 全リストの未完了タスクを取得し、「期限切れ/今日/今後/期限なし」の4グループに分類して返す。
//
// 重要な実装メモ:
// - Tasks はリスト横断の一括取得APIが無く、リストごとに N 回呼ぶ。
// - 期限 `due` は日付のみで時刻を持たず、常に UTC 0時で返る（例 "2026-07-15T00:00:00.000Z"）。
//   new Date() に変換すると端末のタイムゾーン次第で1日ズレるため、
//   先頭10文字（YYYY-MM-DD）を文字列として比較する。

import { ApiError, fetchJson } from '../../google/fetchJson'

const TASKS_BASE = 'https://tasks.googleapis.com/tasks/v1'

interface TaskListResponse {
  items?: { id: string; title: string }[]
}

interface TasksResponse {
  items?: GoogleTask[]
}

interface GoogleTask {
  id: string
  title?: string
  status?: string // 'needsAction' | 'completed'
  due?: string // 日付のみ（UTC0時）。時刻情報は持たない
}

// タスクの分類グループ。表示順もこの順。
export type TaskGroup = 'overdue' | 'today' | 'upcoming' | 'noDue'

export interface TaskItem {
  id: string
  title: string
  listId: string
  listName: string
  dueStr: string | null // 'YYYY-MM-DD' or null
  group: TaskGroup
  // 楽観的追加でまだサーバーにIDが無い仮の項目。true の間は完了操作を不可にする。
  pending?: boolean
}

// Date を端末ローカルの 'YYYY-MM-DD' 文字列に整形する（toISOString を使わず TZ ズレを回避）。
function formatLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 端末ローカルの今日を 'YYYY-MM-DD' 文字列で返す。
function localTodayStr(): string {
  return formatLocalDate(new Date())
}

// 今日から n 日後（ローカル）の 'YYYY-MM-DD'。「明日へ」= n:1 に使う。
export function localDateStrPlusDays(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return formatLocalDate(d)
}

// 「来週へ」用: 今日を基準にした翌週の月曜の 'YYYY-MM-DD'（現在の期限ではなく今日基準）。
// 週明けに仕切り直す意味で月曜に寄せる（Fable 助言）。今日が月曜なら7日後の月曜。
export function localNextMondayStr(): string {
  const day = new Date().getDay() // 0=日,1=月,…,6=土
  const daysToNextMonday = ((8 - day) % 7) || 7
  return localDateStrPlusDays(daysToNextMonday)
}

// 期限文字列と今日から所属グループを決める。
// YYYY-MM-DD 形式は辞書順比較がそのまま日付の前後比較になる。
export function classify(dueStr: string | null, todayStr: string): TaskGroup {
  if (!dueStr) return 'noDue'
  if (dueStr < todayStr) return 'overdue'
  if (dueStr === todayStr) return 'today'
  return 'upcoming'
}

async function fetchTaskLists(): Promise<{ id: string; title: string }[]> {
  const res = await fetchJson<TaskListResponse>(`${TASKS_BASE}/users/@me/lists`)
  return res.items ?? []
}

async function fetchTasksForList(
  list: { id: string; title: string },
  todayStr: string,
): Promise<TaskItem[]> {
  const params = new URLSearchParams({
    showCompleted: 'false', // 未完了のみ（完了済みは非表示）
    showHidden: 'false',
    maxResults: '100',
  })
  const res = await fetchJson<TasksResponse>(
    `${TASKS_BASE}/lists/${encodeURIComponent(list.id)}/tasks?${params.toString()}`,
  )
  const items: TaskItem[] = []
  for (const t of res.items ?? []) {
    if (t.status === 'completed') continue
    const dueStr = t.due ? t.due.slice(0, 10) : null
    items.push({
      id: t.id,
      title: t.title?.trim() || '(タイトルなし)',
      listId: list.id,
      listName: list.title,
      dueStr,
      group: classify(dueStr, todayStr),
    })
  }
  return items
}

// 全リストの未完了タスクをまとめて取得する。
export async function fetchAllTasks(): Promise<TaskItem[]> {
  const todayStr = localTodayStr()
  const lists = await fetchTaskLists()
  // リストごとに並列取得（横断APIが無いため）
  const perList = await Promise.all(lists.map((list) => fetchTasksForList(list, todayStr)))
  return perList.flat()
}

// 端末ローカルの今日を書き戻し用の due（UTC0時のRFC3339）に変換する。
export function toDueValue(dateStr: string): string {
  return `${dateStr}T00:00:00.000Z`
}

export { localTodayStr }

// ---- 書き込み系 ----

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function taskUrl(listId: string, taskId: string): string {
  return `${TASKS_BASE}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`
}

// タスクを完了にする。
export async function completeTask(listId: string, taskId: string): Promise<void> {
  await fetchJson(taskUrl(listId, taskId), {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ status: 'completed' }),
  })
}

// 完了を取り消して未完了に戻す（Undo・再オープン）。
// completed(完了時刻)を明示的に消さないと再オープン扱いにならないため null を送る。
export async function reopenTask(listId: string, taskId: string): Promise<void> {
  await fetchJson(taskUrl(listId, taskId), {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ status: 'needsAction', completed: null }),
  })
}

// タスクのタイトル・期限を更新する。
// dueDateStr に文字列を渡すとその日付に、null を渡すと期限をクリアする（未指定のキーは変更しない）。
// ※ Google Tasks では期限クリアは due:null を送る（completed:null と同様、undefined だと
//   JSON.stringify でキーごと消えてサーバー側に変更が届かないため明示的に null を送る）。
export async function updateTask(
  listId: string,
  taskId: string,
  patch: { title?: string; dueDateStr?: string | null },
): Promise<void> {
  const body: { title?: string; due?: string | null } = {}
  if (patch.title !== undefined) body.title = patch.title
  if (patch.dueDateStr !== undefined) {
    body.due = patch.dueDateStr === null ? null : toDueValue(patch.dueDateStr)
  }
  await fetchJson(taskUrl(listId, taskId), {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
}

// タスクを削除する（Google Tasks は完全削除でゴミ箱・復元エンドポイントは無い）。
// 既に消えている(404)場合も成功扱いにする（冪等=何度呼んでも結果が同じ。Fable 助言）。
export async function deleteTask(listId: string, taskId: string): Promise<void> {
  try {
    await fetchJson(taskUrl(listId, taskId), { method: 'DELETE' })
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return
    throw e
  }
}

// タスクを新規追加する。追加後の正規化済みタスクを返す。
// listId 省略時はユーザーの既定リスト（Google Tasks の "@default" エイリアス）に追加する。
export async function insertTask(input: {
  title: string
  dueDateStr?: string | null
  listId?: string
  listName?: string
}): Promise<TaskItem> {
  const listId = input.listId ?? '@default'
  const body: { title: string; due?: string } = { title: input.title }
  if (input.dueDateStr) body.due = toDueValue(input.dueDateStr)
  const created = await fetchJson<GoogleTask>(
    `${TASKS_BASE}/lists/${encodeURIComponent(listId)}/tasks`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
  )
  const dueStr = created.due ? created.due.slice(0, 10) : (input.dueDateStr ?? null)
  return {
    id: created.id,
    title: created.title?.trim() || input.title,
    listId,
    listName: input.listName ?? '',
    dueStr,
    group: classify(dueStr, localTodayStr()),
  }
}
