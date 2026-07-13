// 外部API（Google 以外・認証不要の天気/ニュース等）向けの、タイムアウト付き fetch（#56）。
// 素の fetch には既定のタイムアウトが無く、応答が返らないと取得中のまま固まりうる。
// AbortController で timeoutMs 経過後に中断する。中断時 fetch は AbortError(DOMException) を投げ、
// errorMessage.ts が「時間内に応答がありませんでした」と案内する。
const DEFAULT_TIMEOUT_MS = 8000

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// レスポンス JSON が配列であることを実行時に確かめる（#56）。API が想定外の形（エラーオブジェクト等）を
// 返したとき、配列前提の .map/.slice が例外で落ちるのを防ぎ、分かりやすいメッセージにする。
export function asArray<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label}の応答が想定した形式ではありませんでした`)
  }
  return value as T[]
}

// レスポンス JSON がオブジェクトであることを実行時に確かめる（#56）。
export function asObject<T>(value: unknown, label: string): T {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}の応答が想定した形式ではありませんでした`)
  }
  return value as T
}
