import { SheetsClient } from "../../infrastructure/google/SheetsClient";

const client = new SheetsClient();
const form = document.getElementById("formCadastro") as HTMLFormElement;

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("formCadastro") as HTMLFormElement;
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = (document.getElementById("nome") as HTMLInputElement).value;
    const email = (document.getElementById("email") as HTMLInputElement).value;
    const obs = (document.getElementById("obs") as HTMLInputElement).value;
    await client.appendRowByHeader("Cadastro", {
      Nome: nome,
      Email: email,
      Observacoes: obs
    });
    alert("Cadastro realizado com sucesso!");
  });
});

