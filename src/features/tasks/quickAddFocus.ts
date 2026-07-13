// PC のキーボードショートカット「/」（クイック追加）で、タスクのクイック追加入力へ
// フォーカスを移すための軽量シグナル。App のキー処理と TasksPanel が別コンポーネントなので、
// scrollTarget.ts と同じ購読可能ストア方式で疎結合に伝える。
import { useSyncExternalStore } from 'react'

let seq = 0 // 連番。押すたびに増やし、TasksPanel は seq 変化で入力にフォーカスする。
const listeners = new Set<() => void>()

// App のキー処理から呼ぶ。クイック追加入力へフォーカスを要求する。
export function requestQuickAddFocus(): void {
  seq++
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// TasksPanel で購読する。seq を useEffect の依存にしてフォーカスを実行する。
export function useQuickAddFocusSignal(): number {
  return useSyncExternalStore(subscribe, () => seq)
}
