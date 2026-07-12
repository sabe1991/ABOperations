/// <reference types="vite/client" />

// vite.config.ts の define で埋め込むコンパイル時定数の型宣言。
// これが無いと TypeScript が「未定義の変数」としてエラーにする。
declare const __COMMIT_HASH__: string
declare const __BUILD_TIME__: string
