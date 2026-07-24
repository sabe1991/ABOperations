// 姉妹ツール「AB Workout」の今週のプラン（複数セッション）を表す型。
// AB Workout の全データ JSON（BackupExporter 形式）の plannedWorkouts / routineItems /
// plannedSets / exercises から「最新の週プラン（同じ aiSession に属する回）」を抽出・整形した形。
// 抽出は GitHub Action 側の build_week_plan.py が行い、Secret Gist の week.json として書き出す。
// カード側（WorkoutDeck）は useWeekPlan() でそれを取得し、既定で「次回（未実施の次の1回）」を
// 表示しつつ ‹ › で週内の前後の回へ送る。ここは週プランの JSON 形（week.json）の型定義。

// 1セット分の目標。ウォームアップ（'warmup'）と本番（'work'）を区別する。
// 重量×レップ系（weight・unit・repsMin/Max）と、時間系（durationSec、例: プランク45秒）の
// 両方を表せるよう、使わない項目は null にする。
export interface PlannedSet {
  type: 'warmup' | 'work'
  weight: number | null
  unit: string | null // 'kg' など（小文字）。時間系種目では null。
  repsMin: number | null
  repsMax: number | null // 単一回数なら repsMin と同値
  durationSec: number | null // 時間系種目の秒数（無ければ null）
}

// 1種目分。bodyPart は日本語の部位名（胸・肩・腕…）に変換済み。note は AI の一言メモ（無ければ null）。
export interface PlannedExercise {
  name: string
  bodyPart: string
  note: string | null
  sets: PlannedSet[]
}

// セッションの状態（未実施・完了・スキップ）。
export type SessionStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED'

// 1回分のセッション。
export interface PlannedSession {
  sessionLabel: string // 例: "Day1: 胸・肩・腕"
  orderInWeek: number // 週内の順番（1始まり）
  status: SessionStatus
  exercises: PlannedExercise[]
}

// 今週のプラン全体（同じ AI 週間プランに属する回の集合）。week.json のトップレベル。
export interface WeekPlan {
  totalInWeek: number // 今週の予定回数（= sessions.length と一致する想定）
  doneInWeek: number // 今週すでに消化した回数（status=COMPLETED の数）
  sessions: PlannedSession[] // orderInWeek 昇順
}
