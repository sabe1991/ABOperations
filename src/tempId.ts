// 楽観更新（サーバー応答を待たずに画面を先に更新する手法）で作る仮エントリの一時ID。
// サーバーが本IDを採番するまでのあいだ、その仮エントリを一意に識別するために使う。
// `temp-${Date.now()}` だと同一ミリ秒内に2件作成したとき ID が衝突し、片方が消えたり
// 取り違えが起きうる。衝突しない UUID を使う（#44）。crypto.randomUUID は
// セキュアコンテキスト（https / localhost）で利用可能で、本アプリは GitHub Pages(https) で動く。
export function tempId(prefix = 'temp'): string {
  return `${prefix}-${crypto.randomUUID()}`
}
