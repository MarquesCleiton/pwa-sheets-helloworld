import { SheetsClient } from "../../infrastructure/google/SheetsClient";
import { GoogleAuthManager } from "../../infrastructure/auth/GoogleAuthManager";
import { loadNavbar } from "../../shared/loadNavbar";

type RowObj = Record<string, string>;
type RowItem = { rowIndex: number; object: RowObj };

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector(s) as T | null;

const alertEl   = $("#alert") as HTMLDivElement | null;
const qInput    = $("#q") as HTMLInputElement | null;
const tbody     = $("#tbody") as HTMLTableSectionElement | null;
const btnAtual  = $("#btnAtualizar") as HTMLButtonElement | null;
const btnSair   = $("#btnSair") as HTMLButtonElement | null;

const TAB = "Cadastro";

function showAlert(msg: string, type: "success" | "warning" | "danger" = "warning") {
  if (!alertEl) return;
  alertEl.className = `alert alert-${type}`;
  alertEl.textContent = msg;
  alertEl.classList.remove("d-none");
}
function clearAlert() { alertEl?.classList.add("d-none"); }

const client = new SheetsClient();

let cache: RowItem[] = [];
let filtered: RowItem[] = [];

function isDash(value: unknown): boolean {
  return String(value ?? "").trim() === "-";
}
function isSoftDeleted(obj: RowObj): boolean {
  // considera "apagada" se TODAS as células conhecidas forem "-"
  const vals = Object.values(obj);
  return vals.length > 0 && vals.every(v => isDash(v));
}

function get(obj: RowObj, ...candidates: string[]): string {
  for (const c of candidates) {
    if (Object.prototype.hasOwnProperty.call(obj, c)) return String(obj[c] ?? "");
  }
  return "";
}

function render(rows: RowItem[]) {
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Nenhum registro encontrado.</td></tr>`;
    return;
  }

  const html = rows.map((r: RowItem) => {
    const o = r.object;
    const nome  = get(o, "Nome", "nome");
    const email = get(o, "Email", "email", "E-mail", "e-mail");
    const obs   = get(o, "Observações", "Observacoes", "observações", "observacoes");
    const img   = get(o, "Imagem", "Foto", "foto", "imagem");

    const imgCell = (() => {
      const url = String(img || "").trim();
      if (url.startsWith("http")) {
        return `<img src="${url}" alt="" class="avatar">`;
      }
      // fallback com iniciais do nome
      const initials = (nome || "?")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(s => s[0]?.toUpperCase() ?? "")
        .join("");
      return `<span class="avatar-fallback">${initials || "?"}</span>`;
    })();

    const editHref = `./editar.html?tab=${encodeURIComponent(TAB)}&rowIndex=${r.rowIndex}`;

    return `
      <tr data-row="${r.rowIndex}">
        <td>${imgCell}</td>
        <td class="fw-medium">${nome || ""}</td>
        <td>${email || ""}</td>
        <td>${obs || ""}</td>
        <td class="text-end">
          <div class="btn-group actions" role="group" aria-label="Ações">
            <a class="btn btn-outline-primary btn-sm" href="${editHref}" title="Editar">
              <i class="bi bi-pencil-square"></i>
            </a>
            <button class="btn btn-outline-danger btn-sm btn-del" title="Excluir">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.innerHTML = html;

  // bind exclusão
  tbody.querySelectorAll<HTMLButtonElement>(".btn-del").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      const tr = (ev.currentTarget as HTMLElement).closest("tr");
      if (!tr) return;
      const idx = Number(tr.getAttribute("data-row") || NaN);
      if (!Number.isInteger(idx)) return;

      if (!confirm("Confirmar exclusão?")) return;

      try {
        await client.softDeleteRowByIndex(TAB, idx);
        // remove da cache local
        cache = cache.filter(r => r.rowIndex !== idx);
        applyFilter();
      } catch (e: any) {
        showAlert(e?.message || "Erro ao excluir.", "danger");
      }
    });
  });
}

function applyFilter() {
  const q = (qInput?.value || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (!q) {
    filtered = cache.slice();
  } else {
    filtered = cache.filter((r: RowItem) => {
      const o = r.object;
      const nome  = get(o, "Nome", "nome");
      const email = get(o, "Email", "email", "E-mail", "e-mail");
      const obs   = get(o, "Observações", "Observacoes", "observações", "observacoes");

      const text = [nome, email, obs]
        .join(" ")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");
      return text.includes(q);
    });
  }
  render(filtered);
}

// ---------- Data ----------
async function load() {
  clearAlert();
  try {
    const rows = await client.getObjectsWithIndex<RowObj>(TAB);
    // normaliza e IGNORA linhas soft-deleted (tudo "-")
    cache = rows
      .map(r => ({ rowIndex: r.rowIndex, object: r.object }))
      .filter((r: RowItem) => !isSoftDeleted(r.object));

    applyFilter();
  } catch (e: any) {
    console.error("Erro ao carregar:", e?.message || e);
    showAlert(e?.message || "Erro ao carregar dados.", "danger");
    cache = [];
    applyFilter();
  }
}

// ---------- Events ----------
document.addEventListener("DOMContentLoaded", () => {
  loadNavbar();
  load();

  qInput?.addEventListener("input", () => applyFilter());
  btnAtual?.addEventListener("click", () => load());

  btnSair?.addEventListener("click", () => {
    try {
      GoogleAuthManager.logout?.();
      localStorage.removeItem("user");
      localStorage.removeItem("accessToken");
    } catch {}
    location.href = "/index.html";
  });
});
