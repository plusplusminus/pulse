import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { __PULSE_API_URL__: JSON.stringify('https://pulse.test') },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
})
