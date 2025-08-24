import { GoogleAuthManager } from "./infrastructure/auth/GoogleAuthManager.js";

// ID do seu projeto no Google Cloud
const CLIENT_ID = "338305920567-bhd608ebcip1u08qf0gb5f08o4je4dnp.apps.googleusercontent.com";

window.addEventListener("DOMContentLoaded", () => {
  const loginStatus = document.getElementById("loginStatus") as HTMLDivElement;

  const checkGISReady = setInterval(async () => {
    if (window.google && window.google.accounts?.id) {
      clearInterval(checkGISReady);

      try {
        // Inicializa autenticação
        await GoogleAuthManager.init(CLIENT_ID);

        // Verifica se já está logado
        if (GoogleAuthManager.isAuthenticated()) {
          loginStatus.textContent = "Você já está logado!";
          loginStatus.className = "alert alert-success";
          window.location.href = "/pages/cadastro.html";
        }
      } catch (error) {
        console.error("Erro na inicialização do login:", error);
        loginStatus.textContent = "Erro ao carregar autenticação.";
        loginStatus.className = "alert alert-danger";
      }
    }
  }, 100);
});