import { navigateTo } from "../../utils/navigation";

const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file";

export class GoogleAuthManager {
  private static clientId: string;

  /**
   * Inicializa o login com Google Identity Services
   */
  static init(clientId: string): void {
    this.clientId = clientId;

    if (!window.google || !window.google.accounts?.id) {
      console.error("Google Identity Services não foi carregado.");
      return;
    }

    window.google.accounts.id.initialize({
      client_id: this.clientId,
      callback: this.handleCredentialResponse.bind(this),
      auto_select: false
    });

    const buttonDiv = document.getElementById("googleSignInBtn");
    if (buttonDiv) {
      window.google.accounts.id.renderButton(buttonDiv, {
        theme: "outline",
        size: "large",
        type: "standard"
      });
    }

    window.google.accounts.id.prompt();
  }

  /**
   * Trata o retorno do login com o ID Token (JWT)
   */
  private static handleCredentialResponse(response: google.accounts.CredentialResponse): void {
    const idToken = response.credential;
    if (!idToken) {
      console.error("Token de ID inválido.");
      return;
    }

    const payload = GoogleAuthManager.decodeJwt(idToken);
    localStorage.setItem("token", idToken);
    localStorage.setItem("user", JSON.stringify({
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
      exp: payload.exp
    }));

    // Tenta obter access token silenciosamente, depois com consentimento se falhar
    this.requestAccessTokenSilentFirst();
  }

  /**
   * Tenta solicitar access_token silenciosamente primeiro, e com consentimento se necessário
   */
  private static requestAccessTokenSilentFirst(): void {
    let triedSilent = false;

    const request = () => {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPES,
        prompt: triedSilent ? 'consent' : '', // silent first, depois consent
        callback: (res: TokenResponse) => {
          if (res.error) {
            if (!triedSilent) {
              triedSilent = true;
              request(); // tenta com consentimento
              return;
            }
            console.error("Erro ao obter access_token:", res);
            return;
          }

          localStorage.setItem("accessToken", res.access_token);
          navigateTo("src/presentation/pages/cadastro.html");
        }
      });

      tokenClient.requestAccessToken();
    };

    request();
  }

  /**
   * Verifica se o usuário está autenticado (ID Token ainda válido)
   */
  static isAuthenticated(): boolean {
    const token = localStorage.getItem("token");
    const userData = localStorage.getItem("user");

    if (!token || !userData) return false;

    try {
      const { exp } = JSON.parse(userData);
      const now = Math.floor(Date.now() / 1000);
      return exp > now;
    } catch {
      return false;
    }
  }

  /**
   * Retorna os dados do usuário logado
   */
  static getUser(): { name: string; email: string; picture: string } | null {
    const user = localStorage.getItem("user");
    if (!user) return null;

    try {
      const parsed = JSON.parse(user);
      return {
        name: parsed.name,
        email: parsed.email,
        picture: parsed.picture
      };
    } catch {
      return null;
    }
  }

  /**
   * Retorna o access_token atual
   */
  static getToken(): string | null {
    return localStorage.getItem("accessToken");
  }

  /**
   * Faz logout e redireciona para a tela de login
   */
  static logout(): void {
    localStorage.removeItem("token");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("user");
    window.location.href = "/login.html";
  }

  /**
   * Decodifica um JWT para obter seu payload
   */
  private static decodeJwt(token: string): any {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join('')
    );
    return JSON.parse(jsonPayload);
  }
}
