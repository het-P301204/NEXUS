import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'storage', '.playwright-mcp', 'scripts/screenshots.ts'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],
      // The API server runs these sources under Node's type stripping, which
      // cannot emit the runtime objects these constructs need.
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'No enum: the server runs this source under type stripping.' },
        { selector: 'TSModuleDeclaration', message: 'No namespace: the server runs this source under type stripping.' },
        { selector: 'TSParameterProperty', message: 'No constructor parameter properties: assign in the body.' },
      ],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The engine is shared by server, browser and simulator. It never reads
    // the wall clock or touches the DOM: "now" is always an argument.
    files: ['lib/engine/**/*.ts', 'rules/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'The engine runs on the server too.' },
        { name: 'window', message: 'The engine runs on the server too.' },
        { name: 'localStorage', message: 'The engine runs on the server too.' },
        { name: 'fetch', message: 'The engine makes no network requests.' },
      ],
      'no-restricted-properties': ['error', { object: 'Date', property: 'now', message: 'Take "now" as an argument so the same inputs give the same deadlines.' }],
    },
  },
)
