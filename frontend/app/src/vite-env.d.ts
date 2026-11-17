/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base as the browser sees it. Default '/api/v1'. */
  readonly VITE_API_BASE_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
