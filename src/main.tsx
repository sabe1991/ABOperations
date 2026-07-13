import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'
import { queryClient } from './queryClient.ts'
import { initTheme } from './features/settings/displayPrefs.ts'
import { initPwaUpdate } from './pwaUpdate.ts'
import './index.css'

// 保存済みの配色テーマ（明/暗/OS追従）を描画前に <html> へ適用し、初回の明暗ちらつきを防ぐ。
initTheme()

// Service Worker を登録し、新バージョン検知・フォアグラウンド復帰時の更新チェックを仕込む（#15）。
initPwaUpdate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
