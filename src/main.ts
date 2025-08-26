import { GoogleAuthManager } from "./infrastructure/auth/GoogleAuthManager.js";
import { navigateTo } from "./utils/navigation.js";

window.addEventListener("DOMContentLoaded", () => {
  const loginStatus = document.getElementById("loginStatus") as HTMLDivElement;
  const loginBtn = document.getElementById("googleSignInBtn");

  if (!loginBtn || !loginStatus) return;

  GoogleAuthManager.init();

  loginBtn.addEventListener("click", async () => {
    try {
      loginStatus.textContent = "Carregando autenticação...";
      loginStatus.className = "alert alert-info";

      await GoogleAuthManager.authenticate();

      loginStatus.textContent = "Login realizado com sucesso!";
      loginStatus.className = "alert alert-success";

      navigateTo("src/presentation/pages/cadastro.html");
    } catch (error) {
      console.error("Erro no login:", error);
      loginStatus.textContent = "Erro ao autenticar. Tente novamente.";
      loginStatus.className = "alert alert-danger";
    }
  });

  if (GoogleAuthManager.isAuthenticated()) {
    navigateTo("src/presentation/pages/cadastro.html");
  }
});
