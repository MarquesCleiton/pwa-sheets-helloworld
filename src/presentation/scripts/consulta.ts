// src/presentation/scripts/consulta.ts
import { GoogleAuthManager } from "../../infrastructure/auth/GoogleAuthManager";
import { SheetsClient, MetaLocalEntry, MetaLocalMap } from "../../infrastructure/google/SheetsClient";
import { DriveClient } from "../../infrastructure/google/DriveClient";
import { loadNavbar } from "../../shared/loadNavbar";

/** ================== Types / Const ================== */
type CadastroRow = {
  rowIndex: number;
  Nome?: string; Email?: string; Observações?: string; Observacoes?: string;
  Imagem?: string; Foto?: string; [k: string]: any;
};

const TAB = "Cadastro";
const DB_NAME = "pwa-rpg-cache";
const DB_VERSION = 1;
const STORE_VERSIONS = "versions";
const STORE_CADASTRO = "cadastro";
const STORE_IMAGES = "images";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const show = (msg: string, type: "success" | "warning" | "danger" = "warning") => {
  const el = $("#alert") as HTMLDivElement | null;
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove("d-none");
};
function initials(name: string) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "U";
}

/** ================== IndexedDB (versions / cadastro / images) ================== */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_VERSIONS)) db.createObjectStore(STORE_VERSIONS);
      if (!db.objectStoreNames.contains(STORE_CADASTRO)) db.createObjectStore(STORE_CADASTRO, { keyPath: "rowIndex" });
      if (!db.objectStoreNames.contains(STORE_IMAGES)) db.createObjectStore(STORE_IMAGES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function getLocalVersion(tab: string): Promise<string | null> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_VERSIONS, "readonly");
    const st = tx.objectStore(STORE_VERSIONS);
    const rq = st.get(tab);
    rq.onsuccess = () => res((rq.result as string) ?? null);
    rq.onerror = () => rej(rq.error);
  });
}
async function setLocalVersion(tab: string, iso: string): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_VERSIONS, "readwrite");
    tx.objectStore(STORE_VERSIONS).put(iso, tab);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function clearCadastro(): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_CADASTRO, "readwrite");
    tx.objectStore(STORE_CADASTRO).clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function putCadastroRows(rows: CadastroRow[]): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_CADASTRO, "readwrite");
    const st = tx.objectStore(STORE_CADASTRO);
    rows.forEach(r => st.put(r));
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function getAllCadastroRows(): Promise<CadastroRow[]> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_CADASTRO, "readonly");
    const st = tx.objectStore(STORE_CADASTRO);
    const rq = st.getAll();
    rq.onsuccess = () => {
      const arr = (rq.result as CadastroRow[]) || [];
      arr.sort((a, b) => a.rowIndex - b.rowIndex);
      res(arr);
    };
    rq.onerror = () => rej(rq.error);
  });
}
async function deleteCadastroRow(rowIndex: number): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_CADASTRO, "readwrite");
    tx.objectStore(STORE_CADASTRO).delete(rowIndex);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function getImageBlob(key: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_IMAGES, "readonly");
    const rq = tx.objectStore(STORE_IMAGES).get(key);
    rq.onsuccess = () => res((rq.result as Blob) ?? null);
    rq.onerror = () => rej(rq.error);
  });
}
async function putImageBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_IMAGES, "readwrite");
    tx.objectStore(STORE_IMAGES).put(blob, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function deleteImageBlob(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_IMAGES, "readwrite");
    tx.objectStore(STORE_IMAGES).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/** ================== Utils (filtros / imagens) ================== */
function getDataFieldValues(obj: Record<string, any>): string[] {
  return Object.entries(obj).filter(([k]) => k !== "rowIndex").map(([, v]) => (v ?? "").toString().trim());
}
function isEmptyRow(obj: Record<string, any>): boolean {
  const vals = getDataFieldValues(obj);
  return vals.length === 0 || vals.every(v => v === "");
}
function isSoftDeleted(obj: Record<string, any>): boolean {
  const vals = getDataFieldValues(obj);
  return vals.length > 0 && vals.every(v => v === "-" || v === "");
}
function isLikelyDriveId(id: string | null | undefined): boolean {
  return !!id && /^[A-Za-z0-9_-]{10,}$/.test(id);
}
function getImageKey(row: CadastroRow): string | null {
  const raw = (row["Imagem"] ?? row["Foto"] ?? row["Imagem URL"] ?? row["ImagemUrl"] ?? row["image"] ?? "").toString().trim();
  if (!raw) return null;
  const id = DriveClient.extractDriveId(raw);
  if (isLikelyDriveId(id)) return `drive:${id!}`;
  return raw.includes("://") ? raw : null;
}
function getDisplayUrl(row: CadastroRow): string | null {
  const raw = (row["Imagem"] ?? row["Foto"] ?? row["Imagem URL"] ?? row["ImagemUrl"] ?? row["image"] ?? "").toString().trim();
  if (!raw) return null;
  const id = DriveClient.extractDriveId(raw);
  if (isLikelyDriveId(id)) return DriveClient.viewUrl(id!, 72);
  return raw.includes("://") ? raw : null;
}
async function fetchDriveImageBlob(fileId: string): Promise<Blob> {
  await GoogleAuthManager.authenticate();
  const token = GoogleAuthManager.getAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive media ${res.status}`);
  return await res.blob();
}
async function cacheImagesForRows(rows: CadastroRow[]) {
  const keys = new Set<string>();
  for (const r of rows) {
    if (isEmptyRow(r) || isSoftDeleted(r)) continue;
    const k = getImageKey(r);
    if (k) keys.add(k);
  }
  await Promise.all(Array.from(keys).map(async (key) => {
    const has = await getImageBlob(key);
    if (has) return;
    if (key.startsWith("drive:")) {
      const blob = await fetchDriveImageBlob(key.slice(6));
      await putImageBlob(key, blob);
      return;
    }
    const res = await fetch(key);
    if (!res.ok) return;
    const blob = await res.blob();
    await putImageBlob(key, blob);
  }));
}
async function objectUrlForRow(r: CadastroRow): Promise<string | null> {
  if (isEmptyRow(r) || isSoftDeleted(r)) return null;
  const key = getImageKey(r);
  const display = getDisplayUrl(r);
  if (!key && !display) return null;
  if (key) {
    const cached = await getImageBlob(key);
    if (cached) return URL.createObjectURL(cached);
  }
  try {
    if (key?.startsWith("drive:")) {
      const blob = await fetchDriveImageBlob(key.slice(6));
      await putImageBlob(key, blob);
      return URL.createObjectURL(blob);
    }
    if (display) {
      const res = await fetch(display);
      if (res.ok) {
        const b = await res.blob();
        await putImageBlob(key || display, b);
        return URL.createObjectURL(b);
      }
    }
  } catch {}
  return display;
}

/** ================== Render ================== */
function rowMatchesQuery(r: CadastroRow, q: string): boolean {
  const n = (r.Nome ?? "").toString().toLowerCase();
  const e = (r.Email ?? "").toString().toLowerCase();
  const o = (r.Observações ?? r.Observacoes ?? "").toString().toLowerCase();
  const needle = q.toLowerCase();
  return n.includes(needle) || e.includes(needle) || o.includes(needle);
}
function editHref(rowIndex: number): string {
  const p = new URLSearchParams({ tab: TAB, rowIndex: String(rowIndex) });
  return `./editar.html?${p.toString()}`;
}
async function render(rows: CadastroRow[]) {
  const tbody = $("#tbody") as HTMLTableSectionElement | null;
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.dataset.row = String(r.rowIndex);

    const tdImg = document.createElement("td");
    tdImg.style.width = "56px";
    try {
      const objUrl = await objectUrlForRow(r);
      if (objUrl) {
        const img = document.createElement("img");
        img.src = objUrl; img.alt = "foto"; img.className = "avatar";
        tdImg.appendChild(img);
      } else {
        const fb = document.createElement("div");
        fb.className = "avatar-fallback";
        fb.textContent = initials(String(r.Nome || ""));
        tdImg.appendChild(fb);
      }
    } catch {
      const fb = document.createElement("div");
      fb.className = "avatar-fallback";
      fb.textContent = initials(String(r.Nome || ""));
      tdImg.appendChild(fb);
    }
    tr.appendChild(tdImg);

    const tdNome = document.createElement("td");
    tdNome.textContent = String(r.Nome ?? ""); tdNome.className = "fw-medium";
    tr.appendChild(tdNome);

    const tdMail = document.createElement("td");
    tdMail.textContent = String(r.Email ?? ""); tr.appendChild(tdMail);

    const tdObs = document.createElement("td");
    tdObs.textContent = String(r.Observações ?? r.Observacoes ?? ""); tr.appendChild(tdObs);

    const tdAct = document.createElement("td");
    tdAct.className = "text-end actions";
    tdAct.innerHTML = `
      <div class="btn-group" role="group" aria-label="Ações">
        <a class="btn btn-outline-primary btn-sm" href="${editHref(r.rowIndex)}" title="Editar">
          <i class="bi bi-pencil-square"></i>
        </a>
        <button class="btn btn-outline-danger btn-sm btn-del" title="Excluir">
          <i class="bi bi-trash"></i>
        </button>
      </div>`;
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  }

  // bind excluir
  const tbodyEl = $("#tbody") as HTMLTableSectionElement | null;
  const sheets = new SheetsClient();
  const drive = new DriveClient();
  tbodyEl?.querySelectorAll<HTMLButtonElement>(".btn-del").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      const tr = (ev.currentTarget as HTMLElement).closest("tr");
      if (!tr) return;
      const idx = Number(tr.getAttribute("data-row") || NaN);
      if (!Number.isInteger(idx)) return;
      const row = currentCache.find(x => x.rowIndex === idx);
      if (!row) return;
      if (!confirm("Confirmar exclusão?")) return;

      // apaga imagem (se houver id)
      const raw = (row["Imagem"] ?? row["Foto"] ?? "").toString().trim();
      const id = DriveClient.extractDriveId(raw);
      if (isLikelyDriveId(id)) {
        try { await (drive as any).deleteFile?.(id); } catch {}
      }
      // soft delete + caches
      await sheets.softDeleteRowByIndex(TAB, row.rowIndex);
      await deleteCadastroRow(row.rowIndex);
      const k = getImageKey(row); if (k) await deleteImageBlob(k);

      // upsert meta e atualizar versões
      const entry = await sheets.upsertMeta(TAB); // grava novo ISO
      await setLocalVersion(TAB, entry.lastMod);

      // atualiza a UI
      currentCache = currentCache.filter(r => r.rowIndex !== idx);
      await render(currentCache);
      show("Registro excluído.", "success");
    });
  });
}

/** ================== Fluxo principal (Local-first) ================== */
let currentCache: CadastroRow[] = [];

/** Baixa Cadastro do Sheets, persiste no cache e retorna os ativos. */
async function refreshCadastroFromSheets(sheets: SheetsClient, newRemoteIso: string | null): Promise<CadastroRow[]> {
  console.log("[sync] baixando Cadastro do Sheets…");
  const rows = await sheets.getObjectsWithIndex<Record<string, any>>(TAB);
  const norm: CadastroRow[] = rows
    .map(r => ({ rowIndex: r.rowIndex, ...(r.object || {}) }))
    .filter(r => !isEmptyRow(r) && !isSoftDeleted(r));

  await clearCadastro();
  await putCadastroRows(norm);
  await cacheImagesForRows(norm);

  if (newRemoteIso) {
    await setLocalVersion(TAB, newRemoteIso);
    console.log("[sync] versão local atualizada para:", newRemoteIso);
  }
  return norm;
}

/**
 * LOCAL-FIRST:
 * 1) lê e renderiza do IndexedDB imediatamente;
 * 2) valida Metadados (fast-path B{linha}); se divergir, baixa Cadastro, atualiza cache e re-renderiza.
 */
async function loadLocalThenValidate({ forceNetwork = false } = {}) {
  const sheets = new SheetsClient();

  // 1) Local primeiro
  let cached = await getAllCadastroRows();
  cached = cached.filter(r => !isEmptyRow(r) && !isSoftDeleted(r));
  currentCache = cached;
  console.log(`[init] renderizando ${cached.length} registros do cache local`);
  await render(currentCache);

  // 2) Validar em background: Metadados por índice (fast-path)
  let metaLocal: MetaLocalMap = sheets.getMetaLocal();
  let entry: MetaLocalEntry | undefined = metaLocal[TAB];
  if (!entry) {
    console.log("[meta] não há entrada local; construindo meta local…");
    metaLocal = await sheets.buildMetaLocalFromSheet();
    entry = metaLocal[TAB];
  }

  const localVer = await getLocalVersion(TAB);
  let remoteVer: string | null = null;
  let needNetwork = !!forceNetwork;

  if (entry && Number.isInteger(entry.index) && entry.index >= 1) {
    try {
      remoteVer = await sheets.getMetaLastModByIndexFast(entry.index);
      console.log("[meta] remoto (fast) =", remoteVer, "(linha", entry.index, ")");
      if (!forceNetwork) needNetwork = (remoteVer == null) || (remoteVer !== localVer);
    } catch (e) {
      console.warn("[meta] fast-path falhou; usando valor local do meta:", e);
      remoteVer = entry.lastMod || null;
      if (!forceNetwork) needNetwork = (remoteVer == null) || (remoteVer !== localVer);
    }
  } else {
    needNetwork = true; // primeira sincronização
  }

  console.log("[check] localVer:", localVer, " | remoteVer:", remoteVer, " | needNetwork:", needNetwork);

  // 3) Se divergente, sincroniza e re-renderiza
  if (needNetwork) {
    try {
      const fresh = await refreshCadastroFromSheets(sheets, remoteVer);
      currentCache = fresh;
      await render(currentCache);
      show("Lista atualizada.", "success");
    } catch (e: any) {
      console.error("[sync] falha ao sincronizar do Sheets:", e);
      // mantém o que já foi exibido do cache
      show("Falha ao atualizar do servidor. Exibindo dados locais.", "warning");
    }
  }
}

/** ================== UI ================== */
function wireUi() {
  const q = $("#q") as HTMLInputElement | null;
  const btnAtualizar = $("#btnAtualizar") as HTMLButtonElement | null;
  const btnSair = $("#btnSair") as HTMLButtonElement | null;

  q?.addEventListener("input", async () => {
    const term = (q.value || "").trim();
    if (!term) return render(currentCache);
    await render(currentCache.filter(r => rowMatchesQuery(r, term)));
  });

  btnAtualizar?.addEventListener("click", () => loadLocalThenValidate({ forceNetwork: true }));

  btnSair?.addEventListener("click", () => {
    try { GoogleAuthManager.logout?.(); } catch {}
    localStorage.clear();
    indexedDB.deleteDatabase(DB_NAME);
    window.location.href = "./index.html";
  });
}

/** ================== Boot ================== */
document.addEventListener("DOMContentLoaded", async () => {
  try { await GoogleAuthManager.authenticate(); } catch {}
  wireUi();
  loadNavbar();
  await loadLocalThenValidate();
});
