// src/presentation/pages/consulta.ts
import { SheetsClient } from "../../infrastructure/google/SheetsClient";
import { GoogleAuthManager } from "../../infrastructure/auth/GoogleAuthManager";
import { loadNavbar } from "../../shared/loadNavbar";         // se não existir, remova
import { baseurl } from "../../utils/navigation";            // se não existir, use caminho estático

const SHEET_TAB = "Cadastro";

const $  = (s: string) => document.querySelector(s) as HTMLElement | null;

const strip = (s: string) => {
  if (!s) return "";
  try { return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim(); }
  catch { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
};

document.addEventListener("DOMContentLoaded", async () => {
  // Navbar global (se tiver)
  try { await (loadNavbar?.()); } catch {}

  const tbody        = $("#tbody") as HTMLTableSectionElement | null;
  const inputFiltro  = $("#q") as HTMLInputElement | null;
  const btnAtualizar = $("#btnAtualizar") as HTMLButtonElement | null;
  const btnSair      = $("#btnSair") as HTMLButtonElement | null;
  const alertBox     = $("#alert") as HTMLDivElement | null;

  if (!tbody) return;

  const showAlert = (m: string, cls: "warning"|"success"|"danger"="warning") => {
    if (!alertBox) return;
    alertBox.className = `alert alert-${cls}`;
    alertBox.textContent = m;
    alertBox.classList.remove("d-none");
  };
  const hideAlert = () => alertBox?.classList.add("d-none");
  const setLoading = (l: boolean) => {
    if (btnAtualizar) { btnAtualizar.disabled = l; btnAtualizar.textContent = l ? "Carregando..." : "Atualizar"; }
  };

  type Linha = { Nome?: string; Email?: string; Observacoes?: string; ["Observações"]?: string };
  type RowUI = { rowIndex: number; nome: string; email: string; observacoes: string };

  let dados: RowUI[] = [];
  const client = new SheetsClient();
  const auth   = new GoogleAuthManager();

  const carregar = async () => {
    hideAlert();
    setLoading(true);
    try {
      const linhas = await client.getObjectsWithIndex<Linha>(SHEET_TAB);
      dados = (linhas || []).map(({ rowIndex, object }) => {
        const nome = (object.Nome ?? (object as any)?.nome ?? "") as string;
        const email = (object.Email ?? (object as any)?.email ?? "") as string;
        const obs =
          (object.Observacoes ??
            object["Observações"] ??
            (object as any)?.observacoes ??
            (object as any)?.observações ??
            "") as string;

        return { rowIndex, nome, email, observacoes: obs };
      })
      // Esconde linhas "apagadas" (só com "-")
      .filter(r => [r.nome, r.email, r.observacoes].some(v => String(v).trim() !== "-"));

      render();
    } catch (e: any) {
      showAlert(e?.message || "Não foi possível carregar os usuários.", "danger");
    } finally {
      setLoading(false);
    }
  };

  const irParaEdicao = (rowIndex: number) => {
    const url = new URL(baseurl?.("src/presentation/pages/editar.html"), window.location.origin);
    url.searchParams.set("tab", SHEET_TAB);
    url.searchParams.set("rowIndex", String(rowIndex));
    console.log(url.toString())
    window.location.href = url.toString();
  };

  const excluir = async (rowIndex: number) => {
    if (rowIndex < 1) return showAlert("rowIndex inválido para exclusão.", "danger");
    if (!confirm("Marcar esta linha como excluída? (os campos serão substituídos por '-')")) return;

    setLoading(true);
    try {
      await client.softDeleteRowByIndex(SHEET_TAB, rowIndex);
      dados = dados.filter(d => d.rowIndex !== rowIndex);
      render();
      showAlert("Linha marcada como excluída.", "success");
    } catch (e: any) {
      showAlert(e?.message || "Erro ao excluir.", "danger");
    } finally {
      setLoading(false);
    }
  };

  const render = () => {
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!dados.length) {
      showAlert('Nenhum usuário encontrado na aba "Cadastro".');
      return;
    }

    const q = strip(inputFiltro?.value || "");
    const lista = q
      ? dados.filter(d =>
          strip(d.nome).includes(q) ||
          strip(d.email).includes(q) ||
          strip(d.observacoes).includes(q)
        )
      : dados;

    for (const r of lista) {
      const tr = document.createElement("tr");

      const tdNome = document.createElement("td");
      tdNome.textContent = r.nome || "—";

      const tdEmail = document.createElement("td");
      tdEmail.textContent = r.email || "—";

      const tdObs = document.createElement("td");
      tdObs.textContent = r.observacoes || "—";

      const tdAcoes = document.createElement("td");
      tdAcoes.className = "text-end";

      // ==== AÇÕES COM ÍCONES, LADO A LADO ====
      const actions = document.createElement("div");
      actions.className = "d-inline-flex align-items-center gap-1";

      const btnEditar = document.createElement("button");
      btnEditar.type = "button";
      btnEditar.className = "btn btn-outline-primary btn-sm";
      btnEditar.setAttribute("aria-label", "Editar");
      btnEditar.innerHTML = `<i class="bi bi-pencil-square"></i><span class="visually-hidden">Editar</span>`;
      btnEditar.addEventListener("click", () => irParaEdicao(r.rowIndex));

      const btnExcluir = document.createElement("button");
      btnExcluir.type = "button";
      btnExcluir.className = "btn btn-outline-danger btn-sm";
      btnExcluir.setAttribute("aria-label", "Excluir");
      btnExcluir.innerHTML = `<i class="bi bi-trash"></i><span class="visually-hidden">Excluir</span>`;
      btnExcluir.addEventListener("click", () => excluir(r.rowIndex));

      actions.appendChild(btnEditar);
      actions.appendChild(btnExcluir);
      tdAcoes.appendChild(actions);
      // =======================================

      tr.appendChild(tdNome);
      tr.appendChild(tdEmail);
      tr.appendChild(tdObs);
      tr.appendChild(tdAcoes);
      tbody.appendChild(tr);
    }
  };

  btnAtualizar?.addEventListener("click", carregar);
  inputFiltro?.addEventListener("input", () => render());
  btnSair?.addEventListener("click", async () => {
    await GoogleAuthManager.logout?.();
    location.reload();
  });

  carregar();
});
