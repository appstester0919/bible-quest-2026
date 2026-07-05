// @ts-check
const { FlatCompat } = require('@eslint/eslintrc')

const compat = new FlatCompat({
  baseDirectory: process.cwd(),
})

module.exports = [
  ...compat.config({
    extends: ['next/core-web-vitals', 'prettier'],
    rules: {
      'no-unused-vars': 'off',
      'react/no-unescaped-entities': 'off',
    },
  }),
]
