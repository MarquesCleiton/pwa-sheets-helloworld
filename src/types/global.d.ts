// src/types/global.d.ts

export { };

declare global {
  interface Window {
    google: typeof google;
  }

  namespace google {
    namespace accounts {
      interface CredentialResponse {
        credential: string;
        select_by: string;
        clientId?: string;
      }

      namespace id {
        function initialize(config: {
          client_id: string;
          callback: (response: CredentialResponse) => void;
          auto_select?: boolean; // <-- Adicionado aqui
        }): void;

        function renderButton(
          parent: HTMLElement,
          options: {
            theme: string;
            size: string;
            type: string;
          }
        ): void;

        function prompt(): void;
      }
    }
  }

}
