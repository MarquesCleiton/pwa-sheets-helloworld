import { SheetsClient } from "../../infrastructure/google/SheetsClient";
import { GoogleAuthManager } from "../../infrastructure/auth/GoogleAuthManager";
// import { baseurl } from "../../utils/navigation"; // se não tiver, pode remover e usar "./consulta.html"

const $ = (s: string) => document.querySelector(s) as HTMLElement | null;

const show = (msg: string, type: "success" | "warning" | "danger" = "warning") => {
  const el = $("#alert") as HTMLDivElement | null;
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove("d-none");
};

/** ====== Auto-expand (altura máx + scrollbar) ======
 *  Uso: const obsAuto = initAutoExpand("#observacoes", 320);
 *       obsAuto?.resize() após setar .value via código.
 */
type AutoExpandCtl = { resize: () => void };
function initAutoExpand(selector: string, maxHeightPx = 320): AutoExpandCtl | null {
  const ta = document.querySelector<HTMLTextAreaElement>(selector);
  if (!ta) return null;

  const apply = () => {
    ta.style.height = "auto";
    const h = ta.scrollHeight;
    if (h > maxHeightPx) {
      ta.style.height = `${maxHeightPx}px`;
      ta.style.overflowY = "auto";
    } else {
      ta.style.height = `${h}px`;
      ta.style.overflowY = "hidden";
    }
  };

  ta.addEventListener("input", apply);
  window.addEventListener("resize", apply);

  // ajuste inicial (evita "pulo")
  requestAnimationFrame(apply);
  setTimeout(apply, 100);

  return { resize: apply };
}

document.addEventListener("DOMContentLoaded", async () => {
  const params   = new URLSearchParams(location.search);
  const tab      = params.get("tab") || "Cadastro";
  const rowIndex = Number(params.get("rowIndex") || NaN);

  // Referências
  const inputTab  = $("#tab") as HTMLInputElement | null;
  const inputIdx  = $("#rowIndex") as HTMLInputElement | null;
  const inputNome = $("#nome") as HTMLInputElement | null;
  const inputMail = $("#email") as HTMLInputElement | null;
  const inputObs  = $("#observacoes") as HTMLTextAreaElement | null;
  const form      = $("#form") as HTMLFormElement | null;

  // Auto-expand (altura máx 320px; ajuste se quiser)
  const obsAuto = initAutoExpand("#observacoes", 320);

  // Contexto
  if (inputTab) inputTab.value = tab;
  if (inputIdx) inputIdx.value = String(rowIndex);

  const client = new SheetsClient();

  try {
    if (!Number.isInteger(rowIndex) || rowIndex < 1) {
      throw new Error("rowIndex inválido para edição (use >= 1).");
    }

    // ✅ Novo: busca APENAS a linha necessária
    const result = await client.getObjectByIndex<Record<string, string>>(tab, rowIndex);
    if (!result) throw new Error("Registro não encontrado para o rowIndex informado.");

    const alvo = result.object;

    // Preenche o formulário (tolerando Observações/Observacoes)
    const nome = alvo["Nome"] ?? (alvo as any)?.nome ?? "";
    const email = alvo["Email"] ?? (alvo as any)?.email ?? "";
    const observacoes =
      alvo["Observações"] ??
      alvo["Observacoes"] ??
      (alvo as any)?.observações ??
      (alvo as any)?.observacoes ??
      "";

    if (inputNome) inputNome.value = String(nome);
    if (inputMail) inputMail.value = String(email);
    if (inputObs)  {
      inputObs.value = String(observacoes);
      obsAuto?.resize(); // garante redimensionamento pós-carregamento
    }
  } catch (e: unknown) {
    const err = e as { message?: string };
    show(err?.message || "Erro ao carregar registro para edição.", "danger");
  }

  // Salvar (update por índice)
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();

    try {
      // Descobre os nomes EXATOS das colunas na planilha
      const headers = await client.getHeaders(tab);
      if (!headers.length) throw new Error("Cabeçalhos não encontrados.");

      // Helper para recuperar o cabeçalho correto (case/acentos)
      const findHeader = (target: "Nome" | "Email" | "Observacoes"): string => {
        const lower = headers.map(h => h.toLowerCase());
        if (target === "Observacoes") {
          const i = lower.findIndex(h => hstartsWithObserva(h)); // Observações/Observacoes
          return i >= 0 ? headers[i] : "Observacoes";
        }
        const i = lower.indexOf(target.toLowerCase());
        return i >= 0 ? headers[i] : target;
      };

      // mini helper só para legibilidade
      const hstartsWithObserva = (h: string) => h.startsWith("observa");

      const data: Record<string, string> = {};
      if (inputNome) data[findHeader("Nome")] = (inputNome.value || "").trim();
      if (inputMail) data[findHeader("Email")] = (inputMail.value || "").trim();
      if (inputObs)  data[findHeader("Observacoes")] = (inputObs.value || "").trim();

      await client.updateRowByIndex(tab, rowIndex, data);
      show("Registro atualizado com sucesso!", "success");

      // (Opcional) voltar para consulta após salvar
      // setTimeout(() => window.location.href = baseurl?.("/src/presentation/pages/consulta.html") || "./consulta.html", 600);
    } catch (e: unknown) {
      const err = e as { message?: string };
      show(err?.message || "Erro ao salvar alterações.", "danger");
    }
  });
});
