// src/presentation/pages/consulta.ts
import { DriveClient } from "../../infrastructure/google/DriveClient";
import { SheetsClient } from "../../infrastructure/google/SheetsClient";
import { loadNavbar } from "../../shared/loadNavbar";
import { navigateTo } from "../../utils/navigation";

type LinhaCadastro = Record<string, any>;
type Usuario = {
  rowIndex: number;              // índice da linha no Sheets (>=1)
  nome: string;
  email: string;
  observacoes: string;
  fotoUrl?: string | null;
  fotoId?: string | null;        // se você gravar o ID do Drive na planilha
};

declare global {
  interface Window {
    deleteDriveFile?: (fileIdOrUrl: string) => Promise<void>;
  }
}

// função utilitária
function extrairIdDoDrive(url: string): string | null {
  if (!url) return null;

  const regex1 = /\/d\/([a-zA-Z0-9_-]{10,})/;
  const regex2 = /id=([a-zA-Z0-9_-]{10,})/;
  const regex3 = /^([a-zA-Z0-9_-]{10,})$/;

  let match = url.match(regex1);
  if (match) return match[1];

  match = url.match(regex2);
  if (match) return match[1];

  match = url.match(regex3);
  if (match) return match[1];

  return null;
}

// atribui no window
window.deleteDriveFile = async (fileUrl: string) => {
  const id = extrairIdDoDrive(fileUrl);
  if (!id) {
    console.warn("Não foi possível extrair ID:", fileUrl);
    return;
  }
  const drive = new DriveClient();
  await drive.deleteFile(id);
  console.log("[Drive] excluindo arquivo do Drive:", id);
};

// ============================ IndexedDB ============================
const DB_NAME = "pwa-sheets-cache";
const DB_VERSION = 2; // <— bumped por causa do novo store de imagens
const STORE_USERS  = "users";
const STORE_IMAGES = "images";

class CacheDB {
  private db: IDBDatabase | null = null;

  async open() {
    if (this.db) return this.db;
    this.db = await new Promise<IDBDatabase>((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_USERS)) {
          const os = db.createObjectStore(STORE_USERS, { keyPath: "key" });
          os.createIndex("by_email", "email");
        }
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
          db.createObjectStore(STORE_IMAGES, { keyPath: "key" }); // key = "id:{fotoId}" ou "url:{hash(url)}"
        }
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return this.db;
  }

  async getAllUsers(): Promise<Usuario[]> {
    console.log("[CacheDB] getAllUsers(): lendo cache...");
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE_USERS, "readonly");
      const st = tx.objectStore(STORE_USERS);
      const req = st.getAll();
      req.onsuccess = () => {
        const rows = (req.result || []).map((x: any) => x.data as Usuario);
        console.log(`[CacheDB] getAllUsers(): ${rows.length} registro(s) do cache`);
        res(rows);
      };
      req.onerror = () => rej(req.error);
    });
  }

  async putUsers(rows: Usuario[]) {
    console.log(`[CacheDB] putUsers(): gravando ${rows.length} registro(s) no cache...`);
    const db = await this.open();
    return new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE_USERS, "readwrite");
      const st = tx.objectStore(STORE_USERS);
      st.clear();
      for (const r of rows) {
        const key = (r.email || r.nome || "").toLowerCase() || `row_${hash(JSON.stringify(r))}`;
        st.put({ key, email: r.email || null, data: r });
      }
      tx.oncomplete = () => { console.log("[CacheDB] putUsers(): concluído."); res(); };
      tx.onerror = () => rej(tx.error);
    });
  }
}

// ======= Cache de Imagens (IndexedDB: STORE_IMAGES) =======
class ImageCache {
  private db: IDBDatabase | null = null;
  constructor(private getDB: () => Promise<IDBDatabase>) {}
  private async dbp() {
    if (this.db) return this.db;
    this.db = await this.getDB();
    return this.db;
  }
  async get(key: string): Promise<Blob | null> {
    const db = await this.dbp();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE_IMAGES, "readonly");
      const st = tx.objectStore(STORE_IMAGES);
      const req = st.get(key);
      req.onsuccess = () => res((req.result && req.result.blob) || null);
      req.onerror = () => rej(req.error);
    });
  }
  async put(key: string, blob: Blob): Promise<void> {
    const db = await this.dbp();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE_IMAGES, "readwrite");
      const st = tx.objectStore(STORE_IMAGES);
      st.put({ key, blob });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async del(key: string): Promise<void> {
    const db = await this.dbp();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE_IMAGES, "readwrite");
      const st = tx.objectStore(STORE_IMAGES);
      st.delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
}

function hash(s: string) { let h = 0, i = 0; while (i < s.length) h = ((h<<5)-h+s.charCodeAt(i++))|0; return Math.abs(h); }
function imageKey(u: Usuario): string | null {
  if (u.fotoId) return `id:${u.fotoId}`;
  if (u.fotoUrl) return `url:${hash(u.fotoUrl)}`;
  return null;
}
async function fetchImageBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Falha ao baixar imagem (${res.status})`);
  return await res.blob();
}

// ============================ App ============================
document.addEventListener("DOMContentLoaded", () => {
  console.log("[Consulta] DOMContentLoaded → init()");
  loadNavbar();

  const tbody = document.getElementById("tbody") as HTMLTableSectionElement | null;
  const inputFiltro = document.getElementById("q") as HTMLInputElement | null;
  const btnAtualizar = document.getElementById("btnAtualizar") as HTMLButtonElement | null;
  const alertBox = document.getElementById("alert") as HTMLDivElement | null;

  if (!tbody) { console.error("[Consulta] ERRO: tbody não encontrado!"); return; }

  const showAlert = (msg: string, type: "info" | "success" | "warning" = "warning") => {
    if (!alertBox) return; alertBox.textContent = msg; alertBox.className = `alert alert-${type}`; alertBox.classList.remove("d-none");
  };
  const hideAlert = () => alertBox?.classList.add("d-none");
  const setLoading = (v: boolean) => { if (btnAtualizar) { btnAtualizar.disabled = v; btnAtualizar.textContent = v ? "Carregando..." : "Atualizar"; } };

  const db = new CacheDB();
  const imgCache = new ImageCache(() => db.open());
  const sheets = new SheetsClient();
  let dados: Usuario[] = [];

  // Normaliza a linha lida da aba "Cadastro" (recebemos (rowIndex, object) do SheetsClient)
  const normalize = (rowIndex: number, obj: LinhaCadastro): Usuario => ({
    rowIndex,
    nome: obj?.Nome ?? obj?.nome ?? "",
    email: obj?.Email ?? obj?.email ?? "",
    observacoes:
      obj?.Observacoes ?? obj?.Observações ??
      obj?.observacoes ?? obj?.observações ?? "",
    // tente todas as variações que você usa:
    fotoUrl: obj?.FotoUrl ?? obj?.fotoUrl ?? obj?.ImageUrl ?? obj?.imageUrl ?? obj?.Imagem ?? obj?.Foto ?? null,
    fotoId:  obj?.FotoId  ?? obj?.fotoId  ?? obj?.ImageId  ?? obj?.imageId  ?? null,
  });

  // Monta célula da foto (placeholder + marcação para hidratação)
  const avatarPlaceholder = (letter: string) =>
    `<span class="avatar-fallback">${escapeHtml(letter)}</span>`;
  const avatarSkeleton = () =>
    `<span class="avatar-fallback" aria-busy="true">…</span>`;

  function avatarCellHtml(u: Usuario) {
    const letter = (String(u.nome || u.email || "?")[0] || "?").toUpperCase();
    const key = imageKey(u);
    if (!u.fotoUrl || !key) {
      return avatarPlaceholder(letter);
    }
    // placeholder + indicadores para hidratação async
    return `
      <img class="avatar d-none" alt="" loading="lazy"
           data-img-key="${escapeHtml(key)}"
           data-img-src="${escapeHtml(u.fotoUrl)}" />
      ${avatarSkeleton()}
    `;
  }

  // Hidrata imagens: busca do cache (ou baixa uma vez) e aplica blob: URL
  async function hydrateImages() {
    if (!tbody) return;
    const nodes = Array.from(tbody.querySelectorAll<HTMLImageElement>("img[data-img-key][data-img-src]"));
    const seen = new Set<string>();

    for (const img of nodes) {
      const key = img.dataset.imgKey!;
      const src = img.dataset.imgSrc!;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        let blob = await imgCache.get(key);
        if (!blob) {
          blob = await fetchImageBlob(src);
          await imgCache.put(key, blob);
        }
        const objUrl = URL.createObjectURL(blob);
        // aplica para todos os <img> com a mesma key
        const allImgs = Array.from(tbody.querySelectorAll<HTMLImageElement>("img[data-img-key]"))
          .filter(el => el.dataset.imgKey === key);
        for (const el of allImgs) {
          el.src = objUrl;
          el.classList.remove("d-none");
          const skel = el.nextElementSibling as HTMLElement | null;
          if (skel && skel.classList.contains("avatar-fallback")) skel.remove();
        }
      } catch (e) {
        console.warn("[Consulta] falha ao hidratar imagem:", e);
        // fallback para placeholder
        const allImgs = Array.from(tbody.querySelectorAll<HTMLImageElement>("img[data-img-key]"))
          .filter(el => el.dataset.imgKey === key);
        for (const el of allImgs) {
          const row = el.closest("tr");
          const nameCell = row?.querySelector("td:nth-child(2)") as HTMLElement | null;
          const letter = (String(nameCell?.textContent || "?")[0] || "?").toUpperCase();
          const parent = el.parentElement!;
          el.remove();
          parent.insertAdjacentHTML("afterbegin", avatarPlaceholder(letter));
          const skel = parent.querySelector(".avatar-fallback[aria-busy='true']");
          if (skel) skel.remove();
        }
      }
    }
  }

  // Renderiza tabela com ações (Editar / Excluir)
  const render = () => {
    console.log("[Consulta] render(): registros em memória =", dados.length);
    tbody!.innerHTML = "";

    const q = (inputFiltro?.value || "").trim().toLowerCase();
    const lista = q
      ? dados.filter(d =>
        (d.nome || "").toLowerCase().includes(q) ||
        (d.email || "").toLowerCase().includes(q) ||
        (d.observacoes || "").toLowerCase().includes(q)
      )
      : dados;

    for (const r of lista) {
      const tr = document.createElement("tr");

      const tdFoto = document.createElement("td");
      tdFoto.innerHTML = avatarCellHtml(r);

      const tdNome = document.createElement("td");
      tdNome.textContent = r.nome || "—";

      const tdEmail = document.createElement("td");
      if (r.email) {
        const a = document.createElement("a");
        a.href = `mailto:${r.email}`;
        a.textContent = r.email;
        tdEmail.appendChild(a);
      } else tdEmail.textContent = "—";

      const tdObs = document.createElement("td");
      tdObs.textContent = r.observacoes || "—";

      const tdActions = document.createElement("td");
      tdActions.className = "text-end actions";
      tdActions.innerHTML = `
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-primary" data-action="edit" data-row="${r.rowIndex}">
            <i class="bi bi-pencil-square"></i>
          </button>
          <button class="btn btn-outline-danger" data-action="delete" data-row="${r.rowIndex}">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      `;

      tr.appendChild(tdFoto);
      tr.appendChild(tdNome);
      tr.appendChild(tdEmail);
      tr.appendChild(tdObs);
      tr.appendChild(tdActions);
      tbody!.appendChild(tr);
    }

    // hidrata imagens após montar a tabela
    void hydrateImages();
  };

  // Busca completa no Sheets (aba "Cadastro") usando getObjectsWithIndex
  const fetchUsersFromSheets = async (): Promise<Usuario[]> => {
    console.log("[Consulta] fetchUsersFromSheets(): lendo do Sheets (Cadastro)...");
    const rows = await sheets.getObjectsWithIndex<Record<string, any>>("Cadastro");

    // ignora linhas soft-deletadas
    const ativos = rows.filter(r => !isSoftDeletedRow(r.object));

    const lista = ativos.map(r => normalize(r.rowIndex, r.object));
    console.log("[Consulta] fetchUsersFromSheets(): recebidos =", rows.length,
      " | ativos =", lista.length, " | excluídos =", rows.length - lista.length);
    return lista;
  };

  // Uma linha é considerada "soft delete" se TODOS os campos string são "-".
  function isSoftDeletedRow(obj: LinhaCadastro): boolean {
    const vals = Object.values(obj ?? {});
    if (!vals.length) return false;
    return vals.every(v => String(v ?? "").trim() === "-");
  }

  // Checa metadados via cache local + fast read
  const ensureMetaLocalEntry = async () => {
    console.log("[Consulta] ensureMetaLocalEntry(): verificando cache local de metadados...");
    let meta = sheets.getMetaLocal();
    let entry = meta["Cadastro"];
    if (entry) { console.log("[Consulta] meta local encontrado:", entry); return entry; }
    console.log("[Consulta] reconstruindo meta local (buildMetaLocalFromSheet)...");
    meta = await sheets.buildMetaLocalFromSheet();
    entry = meta["Cadastro"];
    console.log("[Consulta] meta após rebuild:", entry);
    return entry;
  };

  const hasRemoteUpdate = async (): Promise<boolean> => {
    const entry = await ensureMetaLocalEntry();
    if (!entry) { console.warn("[Consulta] sem meta 'Cadastro' → considerar atualização."); return true; }
    const remoteIso = await sheets.getMetaLastModByIndexFast(entry.index);
    console.log("[Consulta] meta local:", entry.lastMod, " | meta remoto:", remoteIso);
    return !!remoteIso && remoteIso > entry.lastMod;
  };

  const refreshFromRemote = async (msg: string) => {
    console.log("[Consulta] refreshFromRemote():", msg);
    setLoading(true); showAlert(msg, "info");
    try {
      const list = await fetchUsersFromSheets();
      await db.putUsers(list);
      dados = list;
      render();

      // sincroniza o cache local de metadados com o Sheets (mantém coerência mínima)
      if (typeof (sheets as any).upsertMetaLocal === "function") {
        console.log("[Consulta] upsertMetaLocal('Cadastro') para alinhar cache local…");
        await (sheets as any).upsertMetaLocal("Cadastro");
      } else {
        console.log("[Consulta] buildMetaLocalFromSheet() (fallback) …");
        await sheets.buildMetaLocalFromSheet();
      }

      showAlert("Dados atualizados.", "success");
      setTimeout(hideAlert, 1500);
    } catch (err: any) {
      console.error("[Consulta] refreshFromRemote(): erro", err);
      showAlert(err?.message || "Falha ao atualizar dados do Sheets.", "warning");
    } finally { setLoading(false); }
  };

  const checkForUpdates = async (force: boolean) => {
    console.log("[Consulta] checkForUpdates(): force =", force);
    try {
      if (force) showAlert("Verificando atualizações...", "info");
      const changed = await hasRemoteUpdate();
      if (changed) {
        console.log("[Consulta] atualização detectada.");
        await refreshFromRemote("Nova versão encontrada — atualizando...");
      } else if (force) {
        showAlert("Dados já estão atualizados.", "success");
        setTimeout(hideAlert, 1500);
      } else hideAlert();
    } catch (e) {
      console.error("[Consulta] checkForUpdates(): erro", e);
      showAlert("Não foi possível verificar atualizações agora.", "warning");
    }
  };

  // ========= Ações: Editar / Excluir =========
  tbody!.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest("button[data-action]") as HTMLButtonElement | null;
    if (!btn) return;
    const action = btn.dataset.action;
    const rowIndex = Number(btn.dataset.row);
    if (!Number.isFinite(rowIndex) || rowIndex < 1) return;

    const user = dados.find(d => d.rowIndex === rowIndex);
    if (!user) return;

    if (action === "edit") {
      console.log("[Consulta] editar:", user);
      navigateTo(`src/presentation/pages/editar.html?rowIndex=${rowIndex}`);
      return;
    }

    if (action === "delete") {
      console.log("[Consulta] excluir:", user);
      const ok = confirm("Confirma excluir este cadastro? Essa ação é irreversível.");
      if (!ok) return;

      setLoading(true); showAlert("Excluindo cadastro...", "info");
      try {
        // 1) Excluir foto no Drive (se houver) — via hook
        const fileIdOrUrl = user.fotoId || user.fotoUrl;
        if (fileIdOrUrl && typeof window.deleteDriveFile === "function") {
          console.log("[Consulta] Excluindo arquivo no Drive:", fileIdOrUrl);
          await window.deleteDriveFile(fileIdOrUrl);
        }
        // 1.1) Remover do cache de imagens
        const ikey = imageKey(user);
        if (ikey) { try { await imgCache.del(ikey); } catch {} }

        // 2) Atualizar linha no Sheets com "-"
        console.log("[Consulta] Soft delete no Sheets, rowIndex =", rowIndex);
        await sheets.softDeleteRowByIndex("Cadastro", rowIndex);

        // 3) Atualizar cache local (remover o registro)
        console.log("[Consulta] Atualizando cache local (removendo registro)...");
        dados = dados.filter(d => d.rowIndex !== rowIndex);
        await db.putUsers(dados);
        render();

        // 4) Atualizar Metadados no Sheets (ultima atualização) — somente Sheets
        console.log("[Consulta] upsertMetaSheet('Cadastro')...");
        if (typeof (sheets as any).upsertMetaSheet === "function") {
          await (sheets as any).upsertMetaSheet("Cadastro");
        }

        showAlert("Cadastro excluído.", "success");
        setTimeout(hideAlert, 1500);
      } catch (e: any) {
        console.error("[Consulta] Erro ao excluir:", e);
        showAlert(e?.message || "Falha ao excluir cadastro.", "warning");
      } finally {
        setLoading(false);
      }
    }
  });

  // ========= Fluxo inicial =========
  const init = async () => {
    console.log("[Consulta] init(): cache-first");
    const cacheRows = await db.getAllUsers();
    if (cacheRows.length) { dados = cacheRows; render(); }
    // Mesmo com cache, verificamos se há atualização remota; sem cache, forçará refresh.
    await checkForUpdates(false);
  };

  btnAtualizar?.addEventListener("click", () => checkForUpdates(true));
  inputFiltro?.addEventListener("input", () => { console.log("[Consulta] filtro:", inputFiltro?.value); render(); });

  init();
});

// ===== util =====
function escapeHtml(s: any) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
}
