import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Strict mode: any `any` must be disabled inline with a comment explaining why.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The step engine is the safety-critical core: pure TypeScript, no I/O, no clock.
    // Time is passed in with every input so behaviour is deterministic and testable.
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-dom",
                "next",
                "next/*",
                "@supabase/*",
                "@google/genai",
                "server-only",
              ],
              message: "src/engine is pure TypeScript: no framework or I/O imports.",
            },
            {
              group: ["@/*", "!@/engine", "!@/engine/*", "../*"],
              message: "src/engine must not depend on other modules; they depend on it.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "No I/O in the engine." },
        { name: "setTimeout", message: "No timers in the engine; dispatch a tick input." },
        { name: "setInterval", message: "No timers in the engine; dispatch a tick input." },
        { name: "window", message: "No browser APIs in the engine." },
        { name: "document", message: "No browser APIs in the engine." },
        { name: "localStorage", message: "No browser APIs in the engine." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Use the `at` timestamp on the input." },
        { object: "Math", property: "random", message: "The engine must be deterministic." },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
