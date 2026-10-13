/// <reference types="vite/client" />

/**
 * Typed build-time env for the web app.
 *
 * NOTE for the web agent: the .env file lives in the MONOREPO ROOT, so
 * vite.config.ts must set `envDir: "../../"` and `envPrefix: ["VITE_", "PUBLIC_"]`
 * for `import.meta.env.PUBLIC_API_URL` to be inlined.
 */
interface ImportMetaEnv {
  /** Base URL of the API, e.g. "http://localhost:3001". No trailing slash. */
  readonly PUBLIC_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
