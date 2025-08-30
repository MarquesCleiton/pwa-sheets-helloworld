import { GoogleAuthManager } from "../../infrastructure/auth/GoogleAuthManager";
import { SheetsClient, MetaLocalEntry, MetaLocalMap } from "../../infrastructure/google/SheetsClient";
import { DriveClient } from "../../infrastructure/google/DriveClient";

/** ==================== CONFIG ====================
 * Preencha UMA das opções abaixo para centralizar no seu Drive:
 * - rootFolderId: pasta fixa no seu "Meu Drive" (compartilhada com o grupo), ou
 * - driveId: ID de uma Unidade Compartilhada (recomendado se quiser propriedade central).
 */
const CONFIG = {
  DRIVE_ROOT_ID: "1qWCNneRI06SuL_VjUqn0dobAYea-HSew", // ex.: "1AbCDEFghijkLMNO_pastaDoMeuDrive" (ou "" se não for usar)
  DRIVE_SHARED_ID: "",                         // ex.: "0AMXXXXXXXXXXXXXXXX9PVA" (ou "" se não for usar)
  APP_ROOT_NAME: "pwa-sheets-helloworld",      // usado para ensurePath quando não há rootFolderId
  TAB: "Cadastro",
  PRELOAD_IMAGES: true,                        // baixa e salva blobs no IDB em uma atualização
};

const drive = new DriveClient({
  rootFolderId: "1qWCNneRI06SuL_VjUqn0dobAYea-HSew", // 👈 sua pasta central
  appRootName: "pwa-sheets-helloworld",              // mantemos por compatibilidade do cache de paths
});
const sheets = new SheetsClient();

/** ==================== Types / Colunas ==================== */
type Registro = {
  rowIndex: number;
  [k: string]: any;
};
const COLS = {
  nome: "Nome",
  email: "Email",
  obs: "Observações", // aceitamos "Observacoes" ao ler
  foto: "Imagem",     // ou "Foto", se sua planilha usar esse nome
};

/** ==================== DOM ==================== 
 * Ajuste aqui se seu HTML tiver IDs/estrutura diferente.
 */
const cardsEl = document.querySelector<HTMLDivElement>("#cards");      // grid/listagem
const refreshBtn = document.querySelector<HTMLButtonElement>("#btnAtualizar");
const searchInput = document.querySelector<HTMLInputElement>("#busca");
const alertBox = document.querySelector<HTMLDivElement>("#alert");

function showAlert(kind: "success" | "warning" | "danger", msg: string) {
  if (!alertBox) return;
  alertBox.className = `alert alert-${kind}`;
  alertBox.textContent = msg;
  alertBox.classList.remove("d-none");
  setTimeout(() => alertBox.classList.add("d-none"), 4000);
}

/** ==================== Auth guard ==================== */
async function authReady(): Promise<boolean> {
  try {
    const g = (window as any).google;
    if (!g || !g.accounts) {
      console.info("[auth] GIS não disponível ainda → mantendo local-first.");
      return false;
    }
    await GoogleAuthManager.authenticate();
    return true;
  } catch (e) {
    console.info("[auth] não foi possível autenticar agora; seguindo com cache.", e);
    return false;
  }
}

/** ==================== IndexedDB ==================== */
const DB_NAME = "pwa-rpg-cache";
const DB_VERSION = 1;
const STORE_VERSIONS = "versions";
const STORE_CADASTRO = "cadastro";
const STORE_IMAGES = "images";

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
    const rq = tx.objectStore(STORE_VERSIONS).get(tab);
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

async function readAllCadastroFromIDB(): Promise<Registro[]> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_CADASTRO, "readonly");
    const st = tx.objectStore(STORE_CADASTRO);
    const rq = st.getAll();
    rq.onsuccess = () => res((rq.result as Registro[]) ?? []);
    rq.onerror = () => rej(rq.error);
  });
}
async function putManyCadastroToIDB(rows: Registro[]): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_CADASTRO, "readwrite");
    const st = tx.objectStore(STORE_CADASTRO);
    st.clear();
    for (const r of rows) st.put(r);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function getCadastroByRow(rowIndex: number): Promise<Registro | null> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_CADASTRO, "readonly");
    const rq = tx.objectStore(STORE_CADASTRO).get(rowIndex);
    rq.onsuccess = () => res((rq.result as Registro) ?? null);
    rq.onerror = () => rej(rq.error);
  });
}
async function deleteCadastroByRow(rowIndex: number): Promise<void> {
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

/** ==================== Helpers ==================== */
function trim(v: any) { return (v ?? "").toString().trim(); }
function isLikelyDriveId(s: string | null | undefined) { return !!s && /^[A-Za-z0-9_-]{10,}$/.test(s); }
function driveKeyFromAny(v: string | null | undefined): string | null {
  const raw = trim(v);
  if (!raw) return null;
  const id = DriveClient.extractDriveId(raw);
  if (isLikelyDriveId(id)) return `drive:${id!}`;
  return raw.includes("://") ? raw : null;
}

function isSoftDeletedRow(obj: Record<string, any>): boolean {
  const vals = Object.values(obj).map(x => trim(x));
  if (vals.length === 0) return true;
  // considera "apagada" se TODAS as células relevantes são "-"
  const nonEmpty = vals.filter(v => v !== "");
  return nonEmpty.length > 0 && nonEmpty.every(v => v === "-");
}

async function fetchDriveImageBlob(fileId: string): Promise<Blob> {
  await GoogleAuthManager.authenticate();
  const token = GoogleAuthManager.getAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive media ${res.status}`);
  return await res.blob();
}

/** ==================== Render ==================== */
function renderList(rows: Registro[], term = "") {
  if (!cardsEl) return;
  const q = term.toLowerCase();
  cardsEl.innerHTML = "";

  const filtered = rows.filter(r => {
    const n = trim(r[COLS.nome]).toLowerCase();
    const e = trim(r[COLS.email]).toLowerCase();
    const o = trim(r[COLS.obs] ?? r["Observacoes"]).toLowerCase();
    return !q || n.includes(q) || e.includes(q) || o.includes(q);
  });

  for (const r of filtered) {
    const name = trim(r[COLS.nome]);
    const email = trim(r[COLS.email]);
    const obs = trim(r[COLS.obs] ?? r["Observacoes"]);
    const imgAny = trim(r[COLS.foto] ?? r["Foto"]);

    const card = document.createElement("div");
    card.className = "card shadow-sm mb-3";
    card.dataset.rowIndex = String(r.rowIndex);

    const imgWrap = document.createElement("div");
    imgWrap.className = "card-img-top d-flex align-items-center justify-content-center";
    imgWrap.style.minHeight = "140px";
    const img = document.createElement("img");
    img.style.maxHeight = "140px";
    img.style.objectFit = "cover";
    img.loading = "lazy";

    (async () => {
      const key = driveKeyFromAny(imgAny);
      if (key) {
        const cached = await getImageBlob(key);
        if (cached) {
          img.src = URL.createObjectURL(cached);
        } else {
          try {
            if (key.startsWith("drive:") && await authReady()) {
              const blob = await fetchDriveImageBlob(key.slice(6));
              await putImageBlob(key, blob);
              img.src = URL.createObjectURL(blob);
            } else if (!key.startsWith("drive:")) {
              const res = await fetch(key);
              if (res.ok) {
                const blob = await res.blob();
                await putImageBlob(key, blob);
                img.src = URL.createObjectURL(blob);
              } else if (isLikelyDriveId(imgAny)) {
                img.src = DriveClient.viewUrl(imgAny, 256);
              }
            } else if (isLikelyDriveId(imgAny)) {
              img.src = DriveClient.viewUrl(imgAny, 256);
            }
          } catch {
            if (isLikelyDriveId(imgAny)) img.src = DriveClient.viewUrl(imgAny, 256);
          }
        }
      } else {
        // sem imagem → placeholder
        img.alt = "Sem imagem";
      }
    })();

    imgWrap.appendChild(img);
    card.appendChild(imgWrap);

    const body = document.createElement("div");
    body.className = "card-body";
    body.innerHTML = `
      <h5 class="card-title mb-1">${name || "(sem nome)"}</h5>
      <div class="text-muted small mb-2">${email || ""}</div>
      <p class="card-text">${obs || ""}</p>
      <div class="d-flex gap-2">
        <a class="btn btn-sm btn-primary" href="./editar.html?tab=${encodeURIComponent(CONFIG.TAB)}&rowIndex=${r.rowIndex}">Editar</a>
        <button class="btn btn-sm btn-outline-danger" data-action="delete" data-row="${r.rowIndex}">Excluir</button>
      </div>
    `;
    card.appendChild(body);
    cardsEl.appendChild(card);
  }
}

/** ==================== Fluxo Local-first + Metadados ==================== */
async function loadLocalThenValidateAndMaybeSync() {
  // 1) Local-first
  const localRows = await readAllCadastroFromIDB();
  const activeLocal = localRows.filter(r => !isSoftDeletedRow(r));
  renderList(activeLocal);

  // 2) Metadados (fast-path): comparar versão
  let meta: MetaLocalMap = sheets.getMetaLocal();
  let entry: MetaLocalEntry | undefined = meta[CONFIG.TAB];
  if (!entry) {
    if (await authReady()) {
      console.log("[meta] primeira sincronização de índices…");
      meta = await sheets.buildMetaLocalFromSheet();
      entry = meta[CONFIG.TAB];
    } else {
      console.log("[meta] sem auth; permanecendo com dados locais.");
      return; // sem auth e sem índice → não há como validar remoto agora
    }
  }

  const localVer = await getLocalVersion(CONFIG.TAB);
  let remoteVer: string | null = null;

  if (entry && entry.index >= 1) {
    if (await authReady()) {
      try {
        remoteVer = await sheets.getMetaLastModByIndexFast(entry.index);
        console.log("[meta] remoto (fast) =", remoteVer, "linha:", entry.index);
      } catch (e) {
        console.warn("[meta] fast-path falhou; usando cached:", e);
        remoteVer = entry.lastMod || null;
      }
    } else {
      remoteVer = entry.lastMod || null;
    }
  }

  const needSync = (remoteVer == null) || (remoteVer !== localVer);
  console.log("[consulta] needSync?", needSync, "localVer:", localVer, "remoteVer:", remoteVer);

  // 3) Se divergente, baixar tudo do Sheets, filtrar, salvar no IDB, opcionalmente pré-carregar imagens, atualizar versão local
  if (needSync && await authReady()) {
    try {
      console.time("[consulta] fetch Sheets Cadastro");
      const rows = await sheets.getObjectsWithIndex<Record<string, any>>(CONFIG.TAB);
      console.timeEnd("[consulta] fetch Sheets Cadastro");

      const ativos: Registro[] = [];
      for (const r of rows) {
        if (isSoftDeletedRow(r.object)) continue;
        ativos.push({ rowIndex: r.rowIndex, ...r.object });
      }

      console.log("[consulta] ativos:", ativos.length, "de", rows.length);
      await putManyCadastroToIDB(ativos);

      // Pré-carregar imagens (apenas dos ativos)
      if (CONFIG.PRELOAD_IMAGES) {
        console.time("[consulta] preload imagens");
        for (const item of ativos) {
          const any = (item[COLS.foto] ?? item["Foto"]) as string | undefined;
          const key = driveKeyFromAny(any);
          if (!key) continue;
          if (await getImageBlob(key)) continue;
          try {
            if (key.startsWith("drive:") && await authReady()) {
              const b = await fetchDriveImageBlob(key.slice(6));
              await putImageBlob(key, b);
            } else if (!key.startsWith("drive:")) {
              const r = await fetch(key);
              if (r.ok) await putImageBlob(key, await r.blob());
            }
          } catch { /* ignora falhas de preload */ }
        }
        console.timeEnd("[consulta] preload imagens");
      }

      // Atualiza versão local
      if (remoteVer) {
        await setLocalVersion(CONFIG.TAB, remoteVer);
      } else {
        const up = await sheets.upsertMeta(CONFIG.TAB);
        await setLocalVersion(CONFIG.TAB, up.lastMod);
      }

      // re-render atualizado
      renderList(ativos, searchInput?.value || "");
      showAlert("success", "Dados atualizados.");
    } catch (e) {
      console.error(e);
      showAlert("danger", "Falha ao atualizar dados do Sheets.");
    }
  }
}

/** ==================== Deleção (UI + Drive + Sheets + IDB) ==================== */
async function handleDelete(rowIndex: number) {
  if (!Number.isInteger(rowIndex) || rowIndex < 1) return;
  const ok = confirm("Confirma excluir este registro?");
  if (!ok) return;

  try {
    if (!(await authReady())) {
      showAlert("warning", "Não foi possível autenticar agora.");
      return;
    }

    const reg = await getCadastroByRow(rowIndex);
    const imgAny = reg ? trim(reg[COLS.foto] ?? reg["Foto"]) : "";
    const fileId = DriveClient.extractDriveId(imgAny) || "";

    // 1) apaga imagem no Drive (se houver)
    if (fileId) {
      try {
        console.log("[delete] apagando imagem no Drive:", fileId);
        await drive.deleteFile(fileId);
      } catch (e) {
        console.warn("[delete] falha ao apagar imagem no Drive:", e);
      }
      const key = driveKeyFromAny(imgAny);
      if (key) { try { await deleteImageBlob(key); } catch {} }
    }

    // 2) soft delete no Sheets
    console.log("[delete] softDeleteRowByIndex:", CONFIG.TAB, rowIndex);
    await sheets.softDeleteRowByIndex(CONFIG.TAB, rowIndex);

    // 3) atualiza metadados / versão local
    const meta = await sheets.upsertMeta(CONFIG.TAB);
    await setLocalVersion(CONFIG.TAB, meta.lastMod);

    // 4) remove do IndexedDB e do DOM
    await deleteCadastroByRow(rowIndex);
    const card = cardsEl?.querySelector(`[data-row-index="${rowIndex}"]`);
    card?.parentElement?.removeChild(card as Node);

    showAlert("success", "Registro excluído.");
  } catch (e) {
    console.error(e);
    showAlert("danger", "Falha ao excluir registro.");
  }
}

/** ==================== Eventos UI ==================== */
cardsEl?.addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement;
  const btn = t.closest("[data-action='delete']") as HTMLElement | null;
  if (btn) {
    const row = Number(btn.getAttribute("data-row") || "0");
    handleDelete(row);
  }
});

refreshBtn?.addEventListener("click", async () => {
  await loadLocalThenValidateAndMaybeSync();
});

searchInput?.addEventListener("input", async () => {
  const rows = await readAllCadastroFromIDB();
  const ativos = rows.filter(r => !isSoftDeletedRow(r));
  renderList(ativos, searchInput.value);
});

/** ==================== Boot ==================== */
document.addEventListener("DOMContentLoaded", async () => {
  console.time("[consulta] boot");
  try { await GoogleAuthManager.authenticate(); } catch {}
  await loadLocalThenValidateAndMaybeSync();
  console.timeEnd("[consulta] boot");
});
