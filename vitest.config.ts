import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // The worker is Deno and mostly untestable here, but its pure pieces are
    // plain TypeScript with no Deno globals and are worth covering — see
    // supabase/functions/notify/digest.ts.
    include: ["lib/**/*.test.ts", "supabase/functions/**/*.test.ts"],
  },
});
