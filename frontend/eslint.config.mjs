import { defineConfig } from 'eslint/config'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

export default defineConfig([
  ...nextCoreWebVitals,
  {
    // eslint-config-next 16 ships react-hooks 7, whose React Compiler rules flag existing
    // render patterns (refs read in render, setState in effects, Date.now() in render).
    // The app does not use React Compiler; keep them visible as warnings until refactored.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
])
