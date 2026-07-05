// @ts-check
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({
  baseDirectory: process.cwd(),
})

const eslintConfig = [
  ...compat.config({
    extends: ['next/core-web-vitals', 'prettier'],
    rules: {
      'no-unused-vars': 'off',
      'react/no-unescaped-entities': 'off',
    },
  }),
]

export default eslintConfig
