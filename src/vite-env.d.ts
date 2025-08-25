// types.d.ts ou vite-env.d.ts
/// <reference types="vite/client" />
declare module 'vite-plugin-pwa';

export {};

declare global {
  interface Window {
    google: {
      accounts: {
        id: any;
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (res: TokenResponse) => void;
            prompt?: string; // <-- aqui está a correção!
          }) => {
            requestAccessToken: () => void;
          };
        };
      };
    }
  }

  interface TokenResponse {
    access_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
    error?: string;
    error_description?: string;
  }
}


