import { defineConfig } from 'tsup'

const PULSE_API_URL = process.env.PULSE_API_URL ?? 'https://pulse.plusplusminus.co.za'

export default defineConfig([
  {
    // Script-tag embed: auto-initialises from <script data-site> or window.PulseConfig
    entry: { embed: 'src/entries/embed.ts' },
    format: ['iife'],
    globalName: 'Pulse',
    sourcemap: true,
    clean: true,
    target: 'es2020',
    minify: true,
    treeshake: true,
    define: { __PULSE_API_URL__: JSON.stringify(PULSE_API_URL) },
  },
  {
    // npm SDK: import { Pulse } from '@pulse/feedback-widget'
    entry: { sdk: 'src/entries/sdk.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2020',
    minify: true,
    treeshake: true,
    define: { __PULSE_API_URL__: JSON.stringify(PULSE_API_URL) },
  },
  {
    // Cookie-gated loader; unchanged semantics
    entry: { 'pulse-loader': 'src/loader.ts' },
    format: ['iife'],
    sourcemap: false,
    clean: false,
    target: 'es2015',
    minify: true,
    treeshake: true,
    define: { __PULSE_API_URL__: JSON.stringify(PULSE_API_URL) },
  },
])
