import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    // 每个测试文件独立模块注册表, 便于按文件注入 env (DATA_DIR 等)
    isolate: true,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
