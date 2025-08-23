declare var google: any;

class AuthManager {
  private tokenClient: any;
  private accessToken: string = "";
  private expiresAt: number = 0;

  constructor(private clientId: string) {
    this.init();
  }

private async init() {
  await this.waitForGIS();

  google.accounts.id.initialize({
    client_id: this.clientId,
    callback: this.handleCredentialResponse.bind(this),
  });

  google.accounts.id.renderButton(
    document.getElementById("googleSignInBtn"),
    { theme: "outline", size: "large" }
  );

  this.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: this.clientId,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    callback: (resp: any) => {
      if (resp.access_token) {
        this.accessToken = resp.access_token;
        this.expiresAt = Date.now() + resp.expires_in * 1000;
        sessionStorage.setItem("accessToken", this.accessToken);
        sessionStorage.setItem("expiresAt", this.expiresAt.toString());
        console.log("Token armazenado com sucesso.");
      }
    },
  });

  this.restoreSession();
}

private waitForGIS(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (window.google && google.accounts && google.accounts.id) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}


  private handleCredentialResponse(response: any) {
    const data = this.parseJwt(response.credential);
    sessionStorage.setItem("user", JSON.stringify(data));
    this.updateUI(true, data);
    this.showContinueBtn();
  }

  private parseJwt(token: string) {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  }

  private restoreSession() {
    const savedToken = sessionStorage.getItem("accessToken");
    const savedExpiry = sessionStorage.getItem("expiresAt");
    const user = sessionStorage.getItem("user");

    if (savedToken && savedExpiry && user && Date.now() < Number(savedExpiry)) {
      this.accessToken = savedToken;
      this.expiresAt = Number(savedExpiry);
      this.updateUI(true, JSON.parse(user));
    }
  }

  logout() {
    sessionStorage.clear();
    this.accessToken = "";
    this.expiresAt = 0;
    this.updateUI(false);
  }

  private updateUI(loggedIn: boolean, user?: any) {
    const status = document.getElementById("loginStatus")!;
    const logoutBtn = document.getElementById("logoutBtn")!;
    const profile = document.getElementById("userProfile")!;
    const continueBtn = document.getElementById("continueBtn")!;

    if (loggedIn && user) {
      status.textContent = `Logado como ${user.name}`;
      status.className = "alert alert-success text-center";
      logoutBtn.classList.remove("d-none");
      profile.classList.remove("d-none");
      (document.getElementById("userName") as HTMLElement).textContent = user.name;
      (document.getElementById("userEmail") as HTMLElement).textContent = user.email;
      (document.getElementById("userPic") as HTMLImageElement).src = user.picture;
    } else {
      status.textContent = "Faça login para continuar";
      status.className = "alert alert-info text-center";
      logoutBtn.classList.add("d-none");
      profile.classList.add("d-none");
      continueBtn.classList.add("d-none");
    }
  }

  private showContinueBtn() {
    const continueBtn = document.getElementById("continueBtn")!;
    continueBtn.classList.remove("d-none");

    continueBtn.addEventListener("click", () => {
      this.tokenClient.requestAccessToken({ prompt: "" });
      continueBtn.classList.add("d-none");
    });
  }
}

let auth: AuthManager;

document.addEventListener("DOMContentLoaded", () => {
  auth = new AuthManager("338305920567-bhd608ebcip1u08qf0gb5f08o4je4dnp.apps.googleusercontent.com");

  document.getElementById("logoutBtn")!.addEventListener("click", () => {
    auth.logout();
  });
});
