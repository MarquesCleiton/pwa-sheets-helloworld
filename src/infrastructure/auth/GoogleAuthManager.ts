/**
 * Classe responsável pela autenticação via Google Identity Services (GIS)
 * com gerenciamento de token, dados do usuário e renovação automática.
 */
export class GoogleAuthManager {
  private static clientId: string;

  /**
   * Inicializa a autenticação com o Google Identity Services
   * @param clientId - ID OAuth 2.0 do seu projeto Google
   */
  static init(clientId: string): void {
    this.clientId = clientId;
    if (!window.google || !window.google.accounts?.id) {
      console.error("Google Identity Services não foi carregado.");
      return;
    }
    // Inicializa o serviço de login
    window.google.accounts.id.initialize({
      client_id: this.clientId,
      callback: this.handleCredentialResponse.bind(this),
      auto_select: false, // pode mudar para true se quiser login automático direto
    });
    // Renderiza o botão de login, se o container existir
    const buttonDiv = document.getElementById("googleSignInBtn");
    if (buttonDiv) {
      window.google.accounts.id.renderButton(buttonDiv, {
        theme: "outline",
        size: "large",
        type: "standard"
      });
    }
console.log("4...")
    // Tenta login automático, se permitido pelo navegador
    window.google.accounts.id.prompt();
  }

  /**
   * Lida com o retorno do login e salva dados no localStorage
   */
  private static handleCredentialResponse(response: google.accounts.CredentialResponse): void {
    const token = response.credential;

    if (!token) {
      console.error("Token inválido no login.");
      return;
    }

    // Decodifica o token JWT para extrair dados do usuário
    const payload = GoogleAuthManager.decodeJwt(token);

    // Salva o token e dados do usuário
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify({
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
      exp: payload.exp
    }));

  }

  /**
   * Verifica se o usuário está logado e o token ainda é válido
   */
  static isAuthenticated(): boolean {
    const token = localStorage.getItem("token");
    const userData = localStorage.getItem("user");

    if (!token || !userData) return false;

    try {
      const { exp } = JSON.parse(userData);
      const now = Math.floor(Date.now() / 1000); // segundos
      return exp > now;
    } catch {
      return false;
    }
  }

  /**
   * Retorna os dados do usuário autenticado
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
   * Retorna o token atual
   */
  static getToken(): string | null {
    return localStorage.getItem("token");
  }

  /**
   * Efetua logout e redireciona para o login
   */
  static logout(): void {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login.html";
  }

  /**
   * Decodifica um token JWT para extrair o payload (sem validar)
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
