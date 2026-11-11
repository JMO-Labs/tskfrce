import { defineConfig } from 'eslint/config'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

export default defineConfig([
  ...nextCoreWebVitals,
  {
    // Importing `jest` from @jest/globals stops next/jest hoisting jest.mock; use the global.
    files: ['tests/**/*.{ts,tsx}'],
    ignores: ['tests/jest-globals.d.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@jest/globals',
              importNames: ['jest'],
              message: 'Use the global `jest` so next/jest can hoist jest.mock.',
            },
          ],
        },
      ],
    },
  },
])
