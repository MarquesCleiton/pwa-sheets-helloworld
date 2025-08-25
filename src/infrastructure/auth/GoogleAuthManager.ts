import { navigateTo } from "../../utils/navigation";

const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file";

export class GoogleAuthManager {
  static async signIn(clientId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!window.google || !window.google.accounts?.oauth2) {
        reject("Google Identity Services não carregado.");
        return;
      }

      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        prompt: "consent", // ✅ Aqui está correto!
        callback: async (res: TokenResponse) => {
          if (res.error) {
            reject(res.error);
            return;
          }

          const accessToken = res.access_token;

          try {
            const userInfo = await GoogleAuthManager.fetchUserInfo(accessToken);

            localStorage.setItem("accessToken", accessToken);
            localStorage.setItem("user", JSON.stringify({
              name: userInfo.name,
              email: userInfo.email,
              picture: userInfo.picture,
              exp: Math.floor(Date.now() / 1000) + 3600 // 1 hora de validade
            }));

            resolve();
          } catch (err) {
            reject("Erro ao obter dados do usuário: " + err);
          }
        }
      });

      tokenClient.requestAccessToken(); // ✅ Sem argumentos
    });
  }

  private static async fetchUserInfo(accessToken: string) {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!res.ok) throw new Error("Falha ao buscar dados do usuário");

    return await res.json();
  }

  static getToken(): string | null {
    return localStorage.getItem("accessToken");
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

  static isAuthenticated(): boolean {
    const userData = localStorage.getItem("user");
    if (!userData) return false;

    try {
      const { exp } = JSON.parse(userData);
      const now = Math.floor(Date.now() / 1000);
      return exp > now;
    } catch {
      return false;
    }
  }

  static logout(): void {
    localStorage.clear();
    navigateTo("/index.html");
  }
}
