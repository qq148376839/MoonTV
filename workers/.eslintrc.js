module.exports = {
  env: {
    browser: true,
    es2021: true,
    worker: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    'no-console': 'off', // 允许 console 语句
    'no-undef': 'error',
    'no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
    'import/no-anonymous-default-export': 'off',
  },
  globals: {
    // Cloudflare Workers 全局变量
    addEventListener: 'readonly',
    Response: 'readonly',
    Request: 'readonly',
    URL: 'readonly',
    fetch: 'readonly',
  },
};
