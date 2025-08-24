import { SheetsClient } from "../../infrastructure/google/SheetsClient";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("formCadastro") as HTMLFormElement;

  if (!form) {
    console.error("Formulário não encontrado!");
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault(); // 👈 garante que o submit não recarregue a página

    try {
      const nome = (document.getElementById("nome") as HTMLInputElement).value;
      const email = (document.getElementById("email") as HTMLInputElement).value;
      const obs = (document.getElementById("obs") as HTMLInputElement).value;

      const client = new SheetsClient(); // 👈 ideal instanciar aqui (seguro)

      await client.appendRowByHeader("Cadastro", {
        Nome: nome,
        Email: email,
        Observacoes: obs
      });

      alert("Cadastro realizado com sucesso!");
      form.reset(); // 👈 limpa o formulário
    } catch (error) {
      console.error("Erro ao salvar:", error);
      alert("Erro ao salvar os dados. Verifique o console.");
    }
  });
});
