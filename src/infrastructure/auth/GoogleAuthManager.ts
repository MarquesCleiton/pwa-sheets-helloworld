import { navigateTo } from "../../utils/navigation";

const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file";

export class GoogleAuthManager {
  private static clientId: string;

  static init(clientId: string): void {
    this.clientId = clientId;

    if (!window.google || !window.google.accounts?.id) {
      console.error("Google Identity Services não foi carregado.");
      return;
    }

    window.google.accounts.id.initialize({
      client_id: this.clientId,
      callback: this.handleCredentialResponse.bind(this),
      auto_select: false,
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

  private static async handleCredentialResponse(response: google.accounts.CredentialResponse) {
    const idToken = response.credential;
    if (!idToken) {
      console.error("Token inválido no login.");
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

    // Solicita o access_token com os escopos desejados
    try {
      const tokenResponse = await window.google.accounts.oauth2.tokenClient({
        client_id: this.clientId,
        scope: SCOPES,
        callback: (res) => {
          if (res.error) {
            console.error("Erro ao obter access_token:", res);
            return;
          }
          localStorage.setItem("accessToken", res.access_token);
          // Redireciona após obter tudo
          navigateTo("src/presentation/pages/cadastro.html");
        }
      });

      tokenResponse.requestAccessToken();
    } catch (err) {
      console.error("Erro ao requisitar access token:", err);
    }
  }

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

  static getToken(): string | null {
    return localStorage.getItem("accessToken");
  }

  static logout(): void {
    localStorage.removeItem("token");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("user");
    window.location.href = "/login.html";
  }

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
