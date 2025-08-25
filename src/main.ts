import { GoogleAuthManager } from "./infrastructure/auth/GoogleAuthManager.js";
import { navigateTo } from "./utils/navigation.js";

const CLIENT_ID = "338305920567-bhd608ebcip1u08qf0gb5f08o4je4dnp.apps.googleusercontent.com";

window.addEventListener("DOMContentLoaded", () => {
  const loginStatus = document.getElementById("loginStatus") as HTMLDivElement;
  const loginBtn = document.getElementById("googleSignInBtn");

  if (!loginBtn) return;

  loginBtn.addEventListener("click", async () => {
    try {
      loginStatus.textContent = "Carregando autenticação...";
      loginStatus.className = "alert alert-info";

      await GoogleAuthManager.signIn(CLIENT_ID);

      loginStatus.textContent = "Login realizado com sucesso!";
      loginStatus.className = "alert alert-success";

      navigateTo("src/presentation/pages/cadastro.html");
    } catch (error) {
      console.error("Erro no login:", error);
      loginStatus.textContent = "Erro ao autenticar. Tente novamente.";
      loginStatus.className = "alert alert-danger";
    }
  });
});
