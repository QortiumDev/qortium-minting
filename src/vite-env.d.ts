/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_QORTIUM_NODE_API_URL?: string;
  // Dev-only: local Core API key, used solely by the browser-dev fallback to call
  // restricted write endpoints (e.g. removing a minting key). Never used in Home.
  readonly VITE_QORTIUM_NODE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  _qdnLang?: unknown;
  _qdnLanguage?: unknown;
  _qdnTextSize?: unknown;
  _qdnTheme?: unknown;
  _qdnAccent?: unknown;
  qdnRequest?: <T = unknown>(request: Record<string, unknown>) => Promise<T>;
}
