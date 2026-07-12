// メールヘッダ（差出人名・件名）の RFC 2047「エンコードワード」を復号する。
//
// 背景: Gmail API の messages.get(format=metadata) は Subject/From を
// エンコードされたまま返す。日本語メールでは差出人名・件名が
//   =?UTF-8?B?44GK55...?=   （Base64 版）
//   =?ISO-2022-JP?Q?=1B$B...?=  （Quoted-Printable 版）
// のような「エンコードワード」で来るのが普通で、そのまま表示すると読めない。
// ここで =?charset?B|Q?text?= を charset ごとに復号して、素の日本語文字列へ戻す。
//
// エンコードワード内には ASCII しか無いので、この処理自体で XSS が増えることはない
// （復号後もあくまでテキストとして描画する）。charset デコードは TextDecoder に任せる
// （UTF-8 / ISO-2022-JP / Shift_JIS / EUC-JP など WHATWG のラベルに対応）。

// 「B」エンコード（標準 Base64）をバイト列に戻す。
function decodeBase64(text: string): Uint8Array {
  const bin = atob(text.replace(/\s+/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// 「Q」エンコード（RFC 2047 版 Quoted-Printable）をバイト列に戻す。
// - "_" は空白(0x20)、"=XX" は16進1バイト、それ以外はその文字の ASCII コード。
function decodeQ(text: string): Uint8Array {
  const bytes: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '_') {
      bytes.push(0x20)
    } else if (c === '=' && i + 2 < text.length) {
      const code = parseInt(text.slice(i + 1, i + 3), 16)
      if (Number.isNaN(code)) {
        bytes.push(c.charCodeAt(0))
      } else {
        bytes.push(code)
        i += 2
      }
    } else {
      bytes.push(c.charCodeAt(0))
    }
  }
  return new Uint8Array(bytes)
}

// エンコードワードを含むヘッダ文字列を復号する。含まなければそのまま返す。
export function decodeMimeWords(input: string): string {
  if (!input || !input.includes('=?')) return input
  // 隣接するエンコードワードの間の空白は表示しない（RFC 2047）。先に詰めておく。
  const collapsed = input.replace(/\?=\s+=\?/g, '?==?')
  return collapsed.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (whole, charset: string, enc: string, text: string) => {
      try {
        const bytes = enc.toUpperCase() === 'B' ? decodeBase64(text) : decodeQ(text)
        return new TextDecoder(charset.trim().toLowerCase()).decode(bytes)
      } catch {
        // 未知の charset・壊れた Base64 等は復号せず元の表記のまま返す（化けるよりマシ）。
        return whole
      }
    },
  )
}
