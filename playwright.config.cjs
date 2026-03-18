const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './tests',
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
  },
  webServer: [
    {
      command: 'npm run start:functions',
      url: 'http://127.0.0.1:7072/api/health',
      timeout: 120000,
      reuseExistingServer: true,
      env: {
        LOCAL_DEV_AUTH: 'true',
        LOCAL_DEV_USER_ID: 'local-dev-user',
        LOCAL_DEV_USER_NAME: 'Local Developer',
        LOCAL_DEV_USER_EMAIL: 'local.developer@localhost',
        DEFAULT_TENANT_ID: '00000000-0000-0000-0000-000000000001',
        AZURE_FUNCTIONS_ENVIRONMENT: 'Development',
      },
    },
    {
      command: 'npm --prefix frontend-react run build && npm --prefix frontend-react run preview -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      timeout: 120000,
      reuseExistingServer: true,
    },
  ],
})