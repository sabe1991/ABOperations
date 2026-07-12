// タスクパネル（フェーズ3の読み取り版）。
// 全リストの未完了タスクを「⚠期限切れ/今日/今後/期限なし」の4グループで表示する。
// 完了操作・編集・クイック追加などの書き込み系はフェーズ4以降。

import { useTasks } from './useTasks'
import type { TaskGroup, TaskItem } from './api'

// グループの表示順とラベル・装飾。
const GROUP_ORDER: { key: TaskGroup; label: string; variant: string }[] = [
  { key: 'overdue', label: '⚠ 期限切れ', variant: 'overdue' },
  { key: 'today', label: '今日', variant: 'today' },
  { key: 'upcoming', label: '今後', variant: 'upcoming' },
  { key: 'noDue', label: '期限なし', variant: 'noDue' },
]

// 期限文字列を「M/D」の短い表示にする（今日/期限なしグループでは表示しない）。
function formatDue(dueStr: string | null): string {
  if (!dueStr) return ''
  const [, m, d] = dueStr.split('-')
  return `${Number(m)}/${Number(d)}`
}

function groupTasks(tasks: TaskItem[]): Record<TaskGroup, TaskItem[]> {
  const groups: Record<TaskGroup, TaskItem[]> = {
    overdue: [],
    today: [],
    upcoming: [],
    noDue: [],
  }
  for (const t of tasks) groups[t.group].push(t)
  // 期限のあるグループは期限の早い順に並べる
  groups.overdue.sort((a, b) => (a.dueStr ?? '').localeCompare(b.dueStr ?? ''))
  groups.upcoming.sort((a, b) => (a.dueStr ?? '').localeCompare(b.dueStr ?? ''))
  return groups
}

export function TasksPanel() {
  const { data: tasks, isLoading, isError, error } = useTasks()

  if (isLoading) {
    return <p className="panel__note">タスクを読み込み中…</p>
  }
  if (isError) {
    return <p className="panel__note panel__note--error">タスクの取得に失敗しました: {String(error)}</p>
  }
  if (!tasks || tasks.length === 0) {
    return <p className="panel__note">期限切れなし。すべて順調</p>
  }

  const groups = groupTasks(tasks)

  return (
    <div className="tasks">
      {GROUP_ORDER.map(({ key, label, variant }) => {
        const items = groups[key]
        if (items.length === 0) return null
        return (
          <section key={key} className="tasks__group">
            <h3 className={`tasks__group-header tasks__group-header--${variant}`}>
              {label} <span className="tasks__count">{items.length}</span>
            </h3>
            <ul className="tasks__list">
              {items.map((t) => (
                <li key={`${t.listId}:${t.id}`} className="tasks__item">
                  {/* 期限セルは常に描画して3列の位置を揃える（期限なし/今日は空欄） */}
                  <span className="tasks__due">
                    {(key === 'overdue' || key === 'upcoming') && t.dueStr ? formatDue(t.dueStr) : ''}
                  </span>
                  <span className="tasks__title">{t.title}</span>
                  <span className="tasks__list-name">{t.listName}</span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
