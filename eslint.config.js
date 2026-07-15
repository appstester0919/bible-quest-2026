// @ts-check
// Pure flat config (ESLint 9+). We previously used FlatCompat to bridge to the
// legacy .eslintrc.json, but the bridged config triggered a "Converting circular
// structure to JSON" error in @eslint/eslintrc config-validator when run via
// lint-staged. Since eslint-config-next 16.x ships native flat-config exports
// via `eslint-config-next/core-web-vitals`, we can drop FlatCompat entirely.
//
// See: https://nextjs.org/docs/app/api-reference/config/eslint

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import prettier from 'eslint-config-prettier'

export default [
  ...nextCoreWebVitals,
  prettier,
  {
    rules: {
      'no-unused-vars': 'off',
      'react/no-unescaped-entities': 'off',
    },
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'dist/**',
      'coverage/**',
      'next-env.d.ts',
    ],
  },
]
