/**
 * Script-tag embed (dist/embed.global.js, served as /widget/v1/pulse.js).
 *
 *   <script async src="https://pulse.plusplusminus.co.za/widget/v1/pulse.js" data-site="sk_..."></script>
 *
 * Auto-initialises from the script tag's data-* attributes, falling back to
 * window.PulseConfig (cookie loader / SPA path). Exposes window.Pulse for manual control.
 */
import { Pulse, type PulseInstance } from '../index'
import { resolveEmbedConfig, type EmbedDataset } from '../config'
import { getActiveInstance } from '../singleton'
import type { PulseConfig, PulseGlobalConfig } from '../types'

export type { PulseConfig, PulseInstance, SubmitResult } from '../index'

declare global {
  interface Window {
    PulseConfig?: PulseGlobalConfig
  }
}

export function init(config: PulseConfig): PulseInstance {
  return Pulse.init(config)
}

export function open(): void { getActiveInstance()?.open() }
export function close(): void { getActiveInstance()?.close() }
export function destroy(): void { getActiveInstance()?.destroy() }
export function identify(user: { email?: string; name?: string }): void { getActiveInstance()?.identify(user) }
export function setCustom(data: Record<string, string>): void { getActiveInstance()?.setCustom(data) }

function currentScriptDataset(): EmbedDataset | undefined {
  const script = document.currentScript as HTMLScriptElement | null
  return script ? (script.dataset as EmbedDataset) : undefined
}

function autoInit(): void {
  const config = resolveEmbedConfig(currentScriptDataset(), window.PulseConfig)
  if (!config) return
  const boot = () => { Pulse.init(config) }
  if (document.body) boot()
  else document.addEventListener('DOMContentLoaded', boot, { once: true })
}

autoInit()
