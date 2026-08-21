/**
 * The crosshair every "point at the page" mode wears. `html *` and `!important`
 * because a host page's own cursor rules are otherwise more specific than
 * anything the widget can inject from outside its shadow root.
 */
export function crosshairCursor(): HTMLStyleElement {
  const style = document.createElement('style')
  style.setAttribute('data-pulse', 'pick-cursor')
  style.textContent = 'html, html * { cursor: crosshair !important; }'
  document.head.appendChild(style)
  return style
}
