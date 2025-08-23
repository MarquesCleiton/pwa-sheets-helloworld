// main.ts

declare var google: any;

let tokenClient: any;
let accessToken: string | null = null;
let client_id = "338305920567-bhd608ebcip1u08qf0gb5f08o4je4dnp.apps.googleusercontent.com"

// ====================
// Inicialização do Google Sign-In + OAuth
// ====================
function initGoogleSignIn() {
  // 🔹 Inicializa o login com Google (ID token)
  google.accounts.id.initialize({
    client_id: client_id, // substitua pelo seu
    callback: handleCredentialResponse,
  });

  // Renderiza o botão Google
  google.accounts.id.renderButton(
    document.getElementById("googleSignInBtn"),
    { theme: "outline", size: "large" }
  );

  // 🔹 Inicializa o cliente OAuth (para acessar Sheets)
  initTokenClient();
}

// Callback de login
function handleCredentialResponse(response: any) {
  const data = parseJwt(response.credential);
  console.log("Usuário logado com Google:", data);

  exibirUsuario({
    name: data.name,
    email: data.email,
    picture: data.picture,
  });
}

// Inicializa Token Client para Sheets
function initTokenClient() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: client_id, // substitua pelo seu
    scope: "https://www.googleapis.com/auth/spreadsheets",
    callback: (tokenResponse: any) => {
      accessToken = tokenResponse.access_token;
      console.log("Token OAuth recebido:", accessToken);
    },
  });
}

// ====================
// Funções utilitárias
// ====================

// Decodificador simples de JWT
function parseJwt(token: string) {
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

// Exibe dados do usuário
function exibirUsuario(user: { name: string; email: string; picture?: string }) {
  const userDataDiv = document.getElementById("userData")!;
  userDataDiv.innerHTML = `
    <div class="text-center">
      <p><b>Nome:</b> ${user.name}</p>
      <p><b>Email:</b> ${user.email}</p>
      ${
        user.picture
          ? `<img src="${user.picture}" alt="Foto de perfil" class="rounded-circle" width="80"/>`
          : ""
      }
    </div>
  `;
}

// ====================
// Integração com Google Sheets
// ====================
async function salvarNoSheets(nome: string, email: string) {
  if (!accessToken) {
    console.warn("⚠️ Sem token de acesso! Solicitando ao usuário...");
    tokenClient.requestAccessToken();
    return;
  }

  const spreadsheetId = "1FS16zx7piq7kTWa5XDoPd4WcEeSTx8X5Xtx2eOGg1iQ"; // 🔹 copie da URL da sua planilha
  const range = "Página1!A:C"; // 🔹 ajuste o nome da aba/colunas

  const body = {
    values: [nome, email, [new Date().toLocaleString()]],
  };

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=RAW`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    }
  );

  const result = await response.json();
  console.log("Resposta do Sheets:", result);
}

// ====================
// Cadastro manual (formulário)
// ====================
function setupForm() {
  const form = document.getElementById("userForm") as HTMLFormElement;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = (document.getElementById("name") as HTMLInputElement).value;
    const email = (document.getElementById("email") as HTMLInputElement).value;

    exibirUsuario({ name, email });

    // Salva no Sheets
    await salvarNoSheets(name, email);

    form.reset();
  });
}

// ====================
// Inicialização da aplicação
// ====================
window.onload = () => {
  setupForm();
  initGoogleSignIn();
};