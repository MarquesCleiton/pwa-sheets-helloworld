import { SheetsClient } from "../../infrastructure/google/SheetsClient";
import { loadNavbar } from "../../shared/loadNavbar";

type Row = { rowIndex: number; object: Record<string, string> };

// ---------- Config ----------
const DEFAULT_TAB = "Cadastro"; // pode alterar via ?tab= na URL
const REFRESH_MS = 30_000;

// ---------- DOM ----------
const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector(sel) as T | null;

const params = new URLSearchParams(window.location.search);
const tab: string = params.get("tab") || DEFAULT_TAB;

const tbody = $("#tbody") as HTMLTableSectionElement | null;
const inputQ = $("#q") as HTMLInputElement | null;
const btnAtualizar = $("#btnAtualizar") as HTMLButtonElement | null;
const btnSair = $("#btnSair") as HTMLButtonElement | null;
const alertBox = $("#alert") as HTMLDivElement | null;

// ---------- Utils ----------
function showAlert(msg: string, type: "success" | "warning" | "danger" = "warning"): void {
  if (!alertBox) return;
  alertBox.className = `alert alert-${type}`;
  alertBox.textContent = msg;
  alertBox.classList.remove("d-none");
}
function clearAlert(): void {
  alertBox?.classList.add("d-none");
}

function esc(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Linha é soft-deleted quando TODAS as colunas estão com "-"
function isSoftDeleted(obj: Record<string, string>): boolean {
  const vals = Object.values(obj);
  return vals.length > 0 && vals.every((v) => String(v).trim() === "-");
}

// ---------- Estado ----------
const client = new SheetsClient();
let cache: Row[] = [];
let busy = false;
let refreshTimer: number | null = null;

// ---------- Render ----------
function render(rows: Row[]): void {
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr><td colspan="4" class="text-center text-muted py-4">Nenhum registro encontrado.</td></tr>
    `;
    return;
  }

  tbody.innerHTML = rows
    .map(({ rowIndex, object }: Row) => {
      const nome = object["Nome"] ?? "";
      const email = object["Email"] ?? "";
      const obs = object["Observações"] ?? object["Observacoes"] ?? "";

      const hrefEditar = `./editar.html?tab=${encodeURIComponent(tab)}&rowIndex=${rowIndex}`;

      return `
        <tr data-row-index="${rowIndex}">
          <td>${esc(nome)}</td>
          <td>${esc(email)}</td>
          <td class="text-truncate" style="max-width: 420px;">${esc(obs)}</td>
          <td class="text-end">
            <div class="d-inline-flex gap-1">
              <a class="btn btn-sm btn-outline-primary" href="${hrefEditar}" title="Editar">
                <i class="bi bi-pencil"></i>
              </a>
              <button
                class="btn btn-sm btn-outline-danger"
                data-action="delete"
                data-row-index="${rowIndex}"
                title="Excluir"
              >
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

// Aplica filtro no cache e re-renderiza
function applyFilter(): void {
  const q = (inputQ?.value || "").trim().toLowerCase();
  const visible: Row[] = cache
    .filter((r: Row) => !isSoftDeleted(r.object))
    .filter(({ object }: Row) => {
      if (!q) return true;
      const nome = String(object["Nome"] ?? "").toLowerCase();
      const email = String(object["Email"] ?? "").toLowerCase();
      const obs = String(object["Observações"] ?? object["Observacoes"] ?? "").toLowerCase();
      return nome.includes(q) || email.includes(q) || obs.includes(q);
    });

  render(visible);
}

// ---------- Data ----------
async function load(): Promise<void> {
  clearAlert();
  try {
    const rows: Array<{ rowIndex: number; rowNumberA1: number; object: Record<string, string> }> =
      await client.getObjectsWithIndex<Record<string, string>>(tab);

    // normaliza para { rowIndex, object }
    cache = rows.map((r): Row => ({ rowIndex: r.rowIndex, object: r.object }));
    applyFilter();
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.error("Erro ao carregar:", err?.message || e);
    showAlert(err?.message || "Erro ao carregar dados.", "danger");
    cache = [];
    applyFilter();
  }
}

async function softDelete(rowIndex: number): Promise<void> {
  if (!Number.isInteger(rowIndex) || rowIndex < 1) return;
  const ok = window.confirm(`Confirmar exclusão (soft delete) da linha ${rowIndex}?`);
  if (!ok) return;
  try {
    await client.softDeleteRowByIndex(tab, rowIndex);
    await load();
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.error("Erro ao excluir:", err?.message || e);
    showAlert(err?.message || "Erro ao excluir.", "danger");
  }
}

// ---------- Eventos ----------
tbody?.addEventListener("click", (ev: MouseEvent) => {
  const tgt = ev.target as HTMLElement;
  const btn = tgt.closest<HTMLButtonElement>('button[data-action="delete"]');
  if (!btn) return;
  const idxAttr = btn.getAttribute("data-row-index");
  const idx = idxAttr ? Number(idxAttr) : NaN;
  void softDelete(idx);
});

inputQ?.addEventListener("input", () => applyFilter());

btnAtualizar?.addEventListener("click", () => {
  void load();
});

// (opcional) ajuste logout conforme sua app
btnSair?.addEventListener("click", () => {
  try {
    localStorage.removeItem("user");
    localStorage.removeItem("accessToken");
  } catch {
    // ignore
  }
  window.location.href = "../../index.html"; // ajuste se seu path base for diferente
});

// ---------- Auto-refresh 30s (sem reload) ----------
function startAutoRefresh(): void {
  // 1ª carga
  void load();

  refreshTimer = window.setInterval(async () => {
    if (document.visibilityState !== "visible" || busy) return;
    busy = true;
    try {
      await load();
    } finally {
      busy = false;
    }
  }, REFRESH_MS);

  // ao voltar para a aba, força uma atualização
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !busy) {
      void load();
    }
  });
}

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", () => {
  loadNavbar();
  startAutoRefresh();
});

export {};
