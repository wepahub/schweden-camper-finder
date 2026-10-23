// Lint-Konfiguration (ESLint 9+/10, flat config) – ohne zusätzliche Pakete
const browser = Object.fromEntries([
  "window", "document", "navigator", "location", "localStorage", "caches", "fetch", "Response", "URL",
  "URLSearchParams", "AbortController", "DOMException", "setTimeout", "clearTimeout", "requestAnimationFrame",
  "performance", "getComputedStyle", "CSS", "Blob", "Node", "alert", "confirm", "prompt", "console", "self", "L"
].map(g => [g, "readonly"]));

export default [
  {
    files: ["**/*.js"],
    ignores: ["vendor/**"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: browser },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-redeclare": "error",
      "no-self-assign": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "eqeqeq": ["error", "smart"],
      "prefer-const": "error"
    }
  },
  { ignores: ["vendor/**"] }
];
