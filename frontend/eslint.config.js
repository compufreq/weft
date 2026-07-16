import js from "@eslint/js";
import tseslint from "typescript-eslint";
import solid from "eslint-plugin-solid/configs/typescript";
import security from "eslint-plugin-security";

export default tseslint.config(
  {
    ignores: [".vinxi/**", ".output/**", "node_modules/**", "*.config.*"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    ...solid,
  },
  {
    rules: {
      // Solid uses `props.x` access patterns that trip this rule.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
