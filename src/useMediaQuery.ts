import { useSyncExternalStore } from 'react'

// メディアクエリ（「画面幅が○px以上か」などの条件）に一致するかを React に伝える小さなフック。
// 密度型レイアウトの新規部品（24hタイムライン・月グリッド・天気）を
// 「広い PC のときだけ描画する」判定に使う。CSS 側の 1340px の境界と必ず一致させること。
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false, // サーバー描画は無いが、念のため既定は false（＝密度型 OFF）
  )
}

// 密度型レイアウト（段積み3カラム）が有効になる最小幅。index.css の @media と一致させる。
export const WIDE_QUERY = '(min-width: 1340px)'
