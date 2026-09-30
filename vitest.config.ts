import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Server tests open their own in-memory SQLite database per file.
    pool: 'forks',
  },
})
