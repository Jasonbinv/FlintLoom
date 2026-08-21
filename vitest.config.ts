import { tmpdir } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/tests/**/*.test.ts",
      "apps/**/tests/**/*.test.ts",
      "apps/**/tests/**/*.test.tsx",
    ],
  },
  server: {
    fs: {
      allow: ["..", tmpdir()],
    },
  },
});
