import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ビルド時のコミットハッシュを取得する。git が無い環境や失敗時は 'unknown' にフォールバック。
function gitCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  // GitHub Pages はサブパス配信のため base の指定が必須。
  // 前後スラッシュ・大文字小文字までリポジトリ名と完全一致させること（間違えると全アセット404）。
  base: '/ABOperations/',
  plugins: [react()],
  define: {
    // ビルド情報を画面に表示するためのコンパイル時定数。
    // JSON.stringify で囲むことで「文字列リテラル」として埋め込まれる。
    __COMMIT_HASH__: JSON.stringify(gitCommitHash()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
