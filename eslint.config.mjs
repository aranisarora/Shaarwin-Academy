import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Every user-facing timestamp goes through lib/academy-time.ts, so the app
  // renders in academy time (Asia/Kolkata) rather than the viewer's timezone.
  // That set of formatters has already been reconstructed by copy-paste across
  // ~20 components once and had to be collapsed a second time; this makes a
  // third time a lint error. Add the shape you need to academy-time.ts and
  // import it. supabase/functions/ is a separate Deno module graph that cannot
  // import lib/, so its local formatters are legitimate.
  {
    files: ["app/**", "components/**", "lib/**"],
    ignores: ["lib/academy-time.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "NewExpression[callee.object.name='Intl'][callee.property.name='DateTimeFormat']",
          message:
            "Don't build date formatters here — add the shape to lib/academy-time.ts and import it, so everything renders in academy time.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]",
          message:
            "toLocale*String has no timeZone and renders in the viewer's timezone. Use a lib/academy-time.ts formatter instead.",
        },
      ],
    },
  },
]);

export default eslintConfig;
