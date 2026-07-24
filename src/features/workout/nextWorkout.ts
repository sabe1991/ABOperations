// 姉妹ツール「AB Workout」の今週のプラン（複数セッション）を表す型。
// AB Workout の全データ JSON（BackupExporter 形式）の plannedWorkouts / routineItems /
// plannedSets / exercises から「最新の週プラン（同じ aiSession に属する回）」を抽出・整形した形。
// カード側は既定で「次回（未実施の次の1回）」を表示し、＜／＞ で週内の前後の回へ送れる。
// いまはデータの受け渡し方法（秘密Gist経由）が未接続のため sample-data 由来のモック
// （下の WEEK_PLAN_MOCK）で進める。将来ここへ取得フック（例: useWeekPlan()）を足し、
// 同じ WeekPlan 型を返すようにすれば表示側はそのまま使える。

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

// 今週のプラン全体（同じ AI 週間プランに属する回の集合）。
export interface WeekPlan {
  totalInWeek: number // 今週の予定回数（= sessions.length と一致する想定）
  doneInWeek: number // 今週すでに消化した回数（status=COMPLETED の数）
  sessions: PlannedSession[] // orderInWeek 昇順
}

// sample-data/latest.json から抽出した実際の「今週のプラン」（ダミーデータ）。
// 抽出ロジック: 最新の aiSession に属する plannedWorkouts を orderInWeek 順に並べ、
// 各回の routine の routineItems（種目・AIメモ）と plannedSets（目標セット）、
// exercises（種目名・部位）を突き合わせて整形した。
export const WEEK_PLAN_MOCK: WeekPlan = {
  totalInWeek: 3,
  doneInWeek: 0,
  sessions: [
    {
      sessionLabel: 'Day1: 胸・肩・腕',
      orderInWeek: 1,
      status: 'PENDING',
      exercises: [
        {
          name: 'ダンベルベンチプレス',
          bodyPart: '胸',
          note: '前回17.5kgから1ステップアップの20kgに挑戦。コントロールを意識します。',
          sets: [
            { type: 'warmup', weight: 15, unit: 'kg', repsMin: 10, repsMax: 10, durationSec: null },
            { type: 'work', weight: 20, unit: 'kg', repsMin: 8, repsMax: 10, durationSec: null },
            { type: 'work', weight: 20, unit: 'kg', repsMin: 8, repsMax: 10, durationSec: null },
            { type: 'work', weight: 20, unit: 'kg', repsMin: 8, repsMax: 10, durationSec: null },
          ],
        },
        {
          name: 'ダンベルショルダープレス',
          bodyPart: '肩',
          note: '前回9kgから10kgへ1ステップ重量を上げ、丁寧なストロークで行います。',
          sets: [
            { type: 'work', weight: 10, unit: 'kg', repsMin: 8, repsMax: 10, durationSec: null },
            { type: 'work', weight: 10, unit: 'kg', repsMin: 8, repsMax: 10, durationSec: null },
            { type: 'work', weight: 10, unit: 'kg', repsMin: 8, repsMax: 10, durationSec: null },
          ],
        },
        {
          name: 'フレンチプレス',
          bodyPart: '腕',
          note: '前回高回数だったため、重量を上げて適切な筋肥大・筋力向上レンジへ調整します。',
          sets: [
            { type: 'work', weight: 8, unit: 'kg', repsMin: 10, repsMax: 12, durationSec: null },
            { type: 'work', weight: 8, unit: 'kg', repsMin: 10, repsMax: 12, durationSec: null },
            { type: 'work', weight: 8, unit: 'kg', repsMin: 10, repsMax: 12, durationSec: null },
          ],
        },
      ],
    },
    {
      sessionLabel: 'Day2: 背中・脚・体幹',
      orderInWeek: 2,
      status: 'PENDING',
      exercises: [
        {
          name: 'ラットプルダウン',
          bodyPart: '背中',
          note: '過去推定1RMをベースに、効かせやすい重量でしっかり引き切ります。',
          sets: [
            { type: 'warmup', weight: 30, unit: 'kg', repsMin: 10, repsMax: 10, durationSec: null },
            { type: 'work', weight: 40, unit: 'kg', repsMin: 8, repsMax: 12, durationSec: null },
            { type: 'work', weight: 40, unit: 'kg', repsMin: 8, repsMax: 12, durationSec: null },
            { type: 'work', weight: 40, unit: 'kg', repsMin: 8, repsMax: 12, durationSec: null },
          ],
        },
        {
          name: 'バーベルスクワット',
          bodyPart: '脚',
          note: '履歴にない種目のため、フォーム重視の軽めで探る設定から開始します。',
          sets: [
            { type: 'work', weight: 40, unit: 'kg', repsMin: 8, repsMax: 10, durationSec: null },
            { type: 'work', weight: 40, unit: 'kg', repsMin: 8, repsMax: 10, durationSec: null },
            { type: 'work', weight: 40, unit: 'kg', repsMin: 8, repsMax: 10, durationSec: null },
          ],
        },
        {
          name: 'プランク',
          bodyPart: '体幹',
          note: '前回30秒から少し目標を伸ばし、体幹の安定性を高めます。',
          sets: [
            {
              type: 'work',
              weight: null,
              unit: null,
              repsMin: null,
              repsMax: null,
              durationSec: 45,
            },
            {
              type: 'work',
              weight: null,
              unit: null,
              repsMin: null,
              repsMax: null,
              durationSec: 45,
            },
          ],
        },
      ],
    },
    {
      sessionLabel: 'Day3: 全身バランス',
      orderInWeek: 3,
      status: 'PENDING',
      exercises: [
        {
          name: 'バーベルベンチプレス',
          bodyPart: '胸',
          note: '過去の推定1RMから算出。安全な重量でフォームを安定させます。',
          sets: [
            { type: 'warmup', weight: 30, unit: 'kg', repsMin: 10, repsMax: 10, durationSec: null },
            { type: 'work', weight: 40, unit: 'kg', repsMin: 8, repsMax: 10, durationSec: null },
            { type: 'work', weight: 40, unit: 'kg', repsMin: 8, repsMax: 10, durationSec: null },
            { type: 'work', weight: 40, unit: 'kg', repsMin: 8, repsMax: 10, durationSec: null },
          ],
        },
        {
          name: 'シーテッドロー(ケーブル)',
          bodyPart: '背中',
          note: '背中の厚みを作るために、骨盤を立ててしっかり収縮させます。',
          sets: [
            { type: 'work', weight: 40, unit: 'kg', repsMin: 8, repsMax: 12, durationSec: null },
            { type: 'work', weight: 40, unit: 'kg', repsMin: 8, repsMax: 12, durationSec: null },
            { type: 'work', weight: 40, unit: 'kg', repsMin: 8, repsMax: 12, durationSec: null },
          ],
        },
        {
          name: 'レッグプレス',
          bodyPart: '脚',
          note: '履歴にない種目のため、軽めで探る設定。軌道を確認しながら行います。',
          sets: [
            { type: 'work', weight: 60, unit: 'kg', repsMin: 10, repsMax: 12, durationSec: null },
            { type: 'work', weight: 60, unit: 'kg', repsMin: 10, repsMax: 12, durationSec: null },
            { type: 'work', weight: 60, unit: 'kg', repsMin: 10, repsMax: 12, durationSec: null },
          ],
        },
      ],
    },
  ],
}
