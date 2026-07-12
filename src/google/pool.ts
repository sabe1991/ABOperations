// 複数の非同期取得を「同時実行数の上限を守りながら」「1件の失敗で全滅させずに」実行する
// 共通ユーティリティ。
//
// 背景: 予定・タスク・メールは「一覧の各要素を個別に取得する」N+1 構成のため、以前は
// Promise.all で束ねていた。Promise.all は1件でも失敗すると全体が失敗するので、メール1通が
// 取得直後に削除されて 404、あるいはカレンダー1つが一時的に 429(レート制限)/5xx を返した
// だけで、受信トレイ/全予定/全タスクがまるごとエラー表示になっていた。さらに Gmail は
// 最大50件を同時並列で叩くためレート制限に触れやすかった。
// ここで (1)同時実行数の上限、(2)成功分だけ返す(部分失敗を許容)を提供する。

// items を fn で処理する。同時に走るのは最大 limit 件まで。各要素の結果は成功/失敗を
// 個別に保持し(Promise.allSettled 相当)、1件の失敗が他を巻き込まない。順序は入力順を保つ。
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

// allSettled 結果から成功分の値だけを入力順で取り出す（失敗は捨てる）。
export function fulfilledValues<R>(results: PromiseSettledResult<R>[]): R[] {
  const values: R[] = []
  for (const r of results) if (r.status === 'fulfilled') values.push(r.value)
  return values
}

// 全件失敗していたら、最初の失敗理由を投げ直す（成功が1件でもあれば何もしない）。
// 目的: 部分失敗（1通だけ 404 等）は成功分を表示して無視したいが、全件が
// 認証切れ(AuthError)や権限不足(ScopeError)で落ちたケースは握り潰さず、QueryCache の
// 共通ハンドラ（再接続/追加同意への誘導）へ確実に伝える必要があるため。
export function throwIfAllRejected(results: PromiseSettledResult<unknown>[]): void {
  if (results.length === 0) return
  if (results.some((r) => r.status === 'fulfilled')) return
  const firstRejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (firstRejected) throw firstRejected.reason
}
