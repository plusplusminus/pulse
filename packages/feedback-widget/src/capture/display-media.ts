/**
 * The single source of truth for whether this browser can share a screen
 * (PULSE-339). Both getDisplayMedia-backed features gate on it — the HD "Capture
 * tab" screenshot (PULSE-335) and video recording (PULSE-336/338) — so the two
 * buttons can never disagree about what the browser supports.
 *
 * Everything else the widget offers keeps working where this returns false:
 * element pick, the snapdom viewport screenshot and session replay have no
 * dependency on screen capture.
 */

const IOS_DEVICE = /iPad|iPhone|iPod/

/**
 * iOS and iPadOS. iPadOS 13+ reports a desktop Macintosh UA, so the touch-point
 * count is what separates an iPad from a Mac.
 */
export function isIOS(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  maxTouchPoints: number = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints
): boolean {
  if (IOS_DEVICE.test(userAgent)) return true
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1
}

/**
 * Feature detection first, then a UA check for iOS.
 *
 * The UA check is not redundant: every browser on iOS is WebKit underneath and
 * none of them implements screen capture, but some expose a `getDisplayMedia`
 * that is present and simply rejects. Feature detection alone would offer the
 * button and fail at the click.
 */
export function isGetDisplayMediaSupported(): boolean {
  if (typeof navigator === 'undefined') return false
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') return false
  return !isIOS()
}
