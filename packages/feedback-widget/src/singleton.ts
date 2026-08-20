import type { PulseInstance } from './index'

const KEY = '__pulseInstance'

export interface InstanceRegistry {
  [KEY]?: PulseInstance
}

/** Default registry is `window`, so two copies of the bundle on one page share the guard. */
export function defaultRegistry(): InstanceRegistry {
  return (typeof window !== 'undefined' ? window : globalThis) as unknown as InstanceRegistry
}

export function getActiveInstance(registry: InstanceRegistry = defaultRegistry()): PulseInstance | undefined {
  return registry[KEY]
}

/**
 * Register `create()`'s result as the page's single instance. If one is already
 * registered, warn and return it instead of creating a second widget.
 */
export function claimInstance(
  create: () => PulseInstance,
  registry: InstanceRegistry = defaultRegistry(),
  warn: (message: string) => void = (m) => console.warn(m)
): PulseInstance {
  const existing = registry[KEY]
  if (existing) {
    warn('[Pulse] Widget already initialised on this page; ignoring second init (remove the duplicate script tag or Pulse.init call).')
    return existing
  }
  const instance = create()
  registry[KEY] = instance
  return instance
}

export function releaseInstance(instance: PulseInstance, registry: InstanceRegistry = defaultRegistry()): void {
  if (registry[KEY] === instance) delete registry[KEY]
}
