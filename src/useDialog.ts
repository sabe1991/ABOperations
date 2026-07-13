import { useEffect, useRef } from 'react'

// モーダル/ボトムシート共通のアクセシビリティ挙動をまとめたフック（#25 + #55 + スマホ初期フォーカス方針）。
// - Esc キーで閉じる。
// - フォーカストラップ: Tab がダイアログの外へ出ないよう、先頭↔末尾で循環させる。
// - 初期フォーカス: 開いた瞬間にダイアログ内へフォーカスを移す。ただしタッチ端末（スマホ・タブレット）では
//   入力欄に当てるとソフトキーボードが画面を覆ってしまうため、入力ではなくコンテナ自体へフォーカスする。
//   マウス/ペン端末（PC）では先頭の操作要素（多くはタイトル入力）へフォーカスする。
// - 背景本文のスクロールロック（#55）: モーダル表示中は body のスクロールを止める。
// - 閉じたときに、開く前にフォーカスしていた要素へフォーカスを戻す。
//
// 使い方: 返り値の ref をダイアログのコンテナ要素に付け、そのコンテナに tabIndex={-1} を付ける。

// フォーカス可能な要素を拾うセレクタ。tabindex="-1"（プログラム専用フォーカス）は対象外。
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useDialog<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null)
  // onClose を ref 経由で参照し、フックのエフェクトを「マウント時のみ」に保つ
  //（onClose が毎描画で変わってもリスナを張り直さないため）。
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const node = ref.current
    // 開く前にフォーカスしていた要素（閉じたら戻す先）。
    const prevActive = document.activeElement as HTMLElement | null

    // スクロールロック（#55）: 背景のスクロールを止める。閉じたら元へ戻す。
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // 初期フォーカス。タッチ端末では入力に当てず、キーボードが出ないコンテナへ当てる（要望対応）。
    const coarse = window.matchMedia('(pointer: coarse)').matches
    if (node) {
      if (coarse) {
        node.focus()
      } else {
        const first = node.querySelector<HTMLElement>(FOCUSABLE)
        ;(first ?? node).focus()
      }
    }

    function visibleFocusables(): HTMLElement[] {
      if (!node) return []
      // 非表示要素（display:none 等）はフォーカス対象から除く。offsetParent が null なら不可視。
      return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !node) return
      const items = visibleFocusables()
      if (items.length === 0) {
        // 操作要素が無い場合でもフォーカスがダイアログ外へ逃げないようコンテナに留める。
        e.preventDefault()
        node.focus()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const activeEl = document.activeElement as HTMLElement | null
      if (e.shiftKey && activeEl === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && activeEl === lastEl) {
        e.preventDefault()
        firstEl.focus()
      } else if (activeEl && !node.contains(activeEl)) {
        // ダイアログ外にフォーカスが漏れていたら先頭へ引き戻す。
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      // 閉じたら元の要素へフォーカスを戻す（キーボード操作の文脈を保つ）。
      prevActive?.focus?.()
    }
  }, [])

  return ref
}
