import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

// タブリスト（role="tablist"）の矢印キー操作を共通化する小さなヘルパー（#40）。
// WAI-ARIA の「roving tabindex」パターン: 選択中のタブだけ tabIndex=0、他は -1 にしておき、
// ←→（縦なら↑↓）で選択＝フォーカスを隣のタブへ移す。Home/End で先頭/末尾へ。
//
// 使い方:
//   - tablist コンテナに onKeyDown={(e) => handleTablistKeyDown(e, keys, current, onSelect)} を付ける
//   - 各タブボタンに data-tabkey={key} と tabIndex={active ? 0 : -1} を付ける
// これで矢印キー時にこのヘルパーが選択を切り替え、新しいタブへフォーカスを移す。
export function handleTablistKeyDown<K extends string>(
  e: ReactKeyboardEvent<HTMLElement>,
  keys: readonly K[],
  current: K,
  onSelect: (key: K) => void,
): void {
  const idx = keys.indexOf(current)
  if (idx < 0) return
  let next = -1
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = (idx + 1) % keys.length
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      next = (idx - 1 + keys.length) % keys.length
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = keys.length - 1
      break
    default:
      return
  }
  e.preventDefault()
  const key = keys[next]
  onSelect(key)
  // 新しく選んだタブへフォーカスを移す（roving tabindex）。data-tabkey で対象ボタンを探す。
  const tablist = e.currentTarget
  const btn = tablist.querySelector<HTMLElement>(`[data-tabkey="${key}"]`)
  btn?.focus()
}
