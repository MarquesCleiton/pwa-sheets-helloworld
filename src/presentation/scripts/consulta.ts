// src/presentation/pages/consulta.ts
import { SheetsClient } from "../../infrastructure/google/SheetsClient";
import { loadNavbar } from "../../shared/loadNavbar";

/**
 * Página de Consulta de Usuários
 * Lê a aba "Cadastro" da planilha e lista Nome, Email e Observacoes.
 *
 * Requisitos do projeto:
 * - SheetsClient já configurado com o ID da planilha (via .env/localStorage).
 * - loadNavbar() para exibir a navbar inferior em todas as páginas.
 */

document.addEventListener("DOMContentLoaded", () => {
  // 1) Monta a navbar global
  loadNavbar();

  // 2) Referências de UI
  const tbody = document.getElementById("tbody") as HTMLTableSectionElement | null;
  const inputFiltro = document.getElementById("q") as HTMLInputElement | null;
  const btnAtualizar = document.getElementById("btnAtualizar") as HTMLButtonElement | null;
  const alertBox = document.getElementById("alert") as HTMLDivElement | null;

  if (!tbody) {
    console.error("Tabela não encontrada!");
    return;
  }

  // 3) Funções utilitárias de UI
  const showAlert = (msg: string) => {
    if (!alertBox) return;
    alertBox.textContent = msg;
    alertBox.classList.remove("d-none");
  };

  const hideAlert = () => alertBox?.classList.add("d-none");

  const setLoading = (loading: boolean) => {
    if (!btnAtualizar) return;
    btnAtualizar.disabled = loading;
    btnAtualizar.textContent = loading ? "Carregando..." : "Atualizar";
  };

  // 4) Estado local
  let dados: Array<{ nome: string; email: string; observacoes: string }> = [];

  // 5) Carrega dados da planilha usando o cliente genérico
  const carregar = async () => {
    setLoading(true);
    hideAlert();

    try {
      const client = new SheetsClient();
      // getSheetObjects usa a primeira linha como cabeçalho
      const linhas = await client.getSheetObjects<Record<string, string>>("Cadastro");

      // Normaliza chaves (Nome/Email/Observacoes) para o formato usado na UI
      dados = (linhas || []).map((r) => ({
        nome:
          r?.Nome ??
          (r as any)?.nome ??
          "",
        email:
          r?.Email ??
          (r as any)?.email ??
          "",
        observacoes:
          r?.Observacoes ??
          (r as any)?.Observações ??
          (r as any)?.observacoes ??
          (r as any)?.observações ??
          "",
      }));

      render();
    } catch (err: any) {
      console.error("Erro ao buscar dados:", err);
      showAlert(err?.message || "Não foi possível carregar os usuários.");
    } finally {
      setLoading(false);
    }
  };

  // 6) Renderiza a tabela com base no filtro
  const render = () => {
    tbody.innerHTML = "";

    if (!dados.length) {
      showAlert('Nenhum usuário encontrado na aba "Cadastro".');
      return;
    }

    const q = (inputFiltro?.value || "").trim().toLowerCase();

    const lista = q
      ? dados.filter(
          (d) =>
            (d.nome || "").toLowerCase().includes(q) ||
            (d.email || "").toLowerCase().includes(q)
        )
      : dados;

    for (const r of lista) {
      const tr = document.createElement("tr");

      const tdNome = document.createElement("td");
      tdNome.textContent = r.nome || "—";

      const tdEmail = document.createElement("td");
      if (r.email) {
        const a = document.createElement("a");
        a.href = `mailto:${r.email}`;
        a.textContent = r.email;
        tdEmail.appendChild(a);
      } else {
        tdEmail.textContent = "—";
      }

      const tdObs = document.createElement("td");
      tdObs.textContent = r.observacoes || "—";

      tr.appendChild(tdNome);
      tr.appendChild(tdEmail);
      tr.appendChild(tdObs);
      tbody.appendChild(tr);
    }
  };

  // 7) Eventos de UI
  btnAtualizar?.addEventListener("click", carregar);
  inputFiltro?.addEventListener("input", render);

  // 8) Primeira carga
  carregar();
});
