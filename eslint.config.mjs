import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    // React Compiler advisories that arrived with eslint-plugin-react-hooks
    // v7. They flag patterns that are correct today but could be faster;
    // kept visible as warnings so they can be worked through, rather than
    // blocking a deploy.
    files: ["**/*.{js,jsx,mjs,ts,tsx}"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/incompatible-library": "warn",
    },
  },
  {
    // The test suite is plain CommonJS run by `node --test`.
    files: ["tests/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      ".test-build/**",
      ".ui-backup/**",
      ".backups/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
