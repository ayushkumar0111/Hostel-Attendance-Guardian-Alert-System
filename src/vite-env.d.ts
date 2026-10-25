/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_INSTITUTION_NAME?: string;
  readonly VITE_COLLEGE_UNIT?: string;
  readonly VITE_APP_TITLE?: string;
  readonly VITE_AUTHOR_CREDIT?: string;
  readonly VITE_ORG_CREDIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
