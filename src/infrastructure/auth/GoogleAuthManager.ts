const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file";

export class GoogleAuthManager {
  private static clientId = "338305920567-bhd608ebcip1u08qf0gb5f08o4je4dnp.apps.googleusercontent.com";

  static init(): void {
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
      console.warn("Google Identity Services ainda não carregado.");
    }
  }

  static isAuthenticated(): boolean {
    const token = localStorage.getItem("accessToken");
    const exp = localStorage.getItem("accessTokenExpiresAt");
    const isAuthenticated = !!token && !!exp && Date.now() < Number(exp);
    console.log("isAuthenticated:", isAuthenticated);
    return isAuthenticated;
  }

  static async authenticate(): Promise<void> {
    const valid = await this.ensureValidToken();
    if (!valid) {
      await this.interactiveLogin();
    }
  }

  private static async interactiveLogin(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPES,
        prompt: "consent",
        callback: async (res: TokenResponse) => {
          if (res.error) {
            reject(new Error("Erro ao obter access token"));
            return;
          }

          this.storeCredentials(res.access_token, res.expires_in);

          try {
            const userInfo = await this.fetchUserInfo(res.access_token);
            localStorage.setItem("user", JSON.stringify(userInfo));
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      });

      tokenClient.requestAccessToken();
    });
  }

private static async ensureValidToken(): Promise<boolean> {
  if (this.isAuthenticated()) {
    return true;
  }

  return new Promise((resolve) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: SCOPES,
      prompt: "", // silent
      callback: async (res) => {
        if (res.error || !res.access_token) {
          resolve(false);
        } else {
          this.storeCredentials(res.access_token, res.expires_in);

          // Se ainda não há informações do usuário salvas, busca agora
          if (!localStorage.getItem("user")) {
            try {
              const userInfo = await this.fetchUserInfo(res.access_token);
              localStorage.setItem("user", JSON.stringify(userInfo));
            } catch (err) {
              console.warn("Falha ao buscar informações do usuário no login silencioso:", err);
            }
          }

          resolve(true);
        }
      }
    });

    tokenClient.requestAccessToken();
  });
}

  static getAccessToken(): string {
    const token = localStorage.getItem("accessToken");
    if (!token) throw new Error("Token de acesso não encontrado.");
    return token;
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

  static logout(): void {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("accessTokenExpiresAt");
    localStorage.removeItem("user");
    window.location.href = "/login.html";
  }

  private static storeCredentials(token: string, expiresIn?: number) {
    localStorage.setItem("accessToken", token);
    const expirationTime = Date.now() + (expiresIn || 3600) * 1000;
    localStorage.setItem("accessTokenExpiresAt", expirationTime.toString());
  }

  private static async fetchUserInfo(accessToken: string): Promise<{ name: string; email: string; picture: string }> {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!res.ok) throw new Error("Erro ao obter dados do usuário");

    return res.json();
  }
}
