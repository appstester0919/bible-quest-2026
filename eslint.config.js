import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import nextPlugin from 'eslint-config-next';

export default [
  ...nextPlugin.configs.recommended,
  js.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'next-env.d.ts'],
  },
];
