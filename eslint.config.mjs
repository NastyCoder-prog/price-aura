import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const config = [
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'coverage/**', 'public/**', 'pnpm-lock.yaml'],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@next/next/no-img-element': 'off',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
]

export default config
