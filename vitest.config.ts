import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `collectors*` matches the public collectors and the private submodule when checked out.
    projects: ['packages/*', 'apps/web', 'collectors*'],
  },
});
