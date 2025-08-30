// src/presentation/pages/editar.ts
import { SheetsClient } from "../../infrastructure/google/SheetsClient";
import { loadNavbar } from "../../shared/loadNavbar";
import { navigateTo } from "../../utils/navigation";

const SHARED_FOLDER_ID = "1zId11Ydti8d0FOQoQjd9lQmPo6GiJx26"; // Pasta fixa

type LinhaCadastro = Record<string, any>;
type Usuario = {
  rowIndex: number;
  nome: string;
  email: string;
  observacoes: string;
  fotoUrl?: string | null;
  fotoId?: string | null;
};

declare global {
  interface Window {
    deleteDriveFile?: (fileIdOrUrl: string) => Promise<void>;
    uploadDriveImage?: (file: File) => Promise<{ id?: string; url?: string }>;
  }
}

// ===== Utils Drive =====
function extrairIdDoDrive(url: string): string | null {
  if (!url) return null;
  const regex1 = /\/d\/([a-zA-Z0-9_-]{10,})/;
  const regex2 = /id=([a-zA-Z0-9_-]{10,})/;
  const regex3 = /^([a-zA-Z0-9_-]{10,})$/;
  let m = url.match(regex1); if (m) return m[1];
  m = url.match(regex2); if (m) return m[1];
  m = url.match(regex3); if (m) return m[1];
  return null;
}

// Excluir
window.deleteDriveFile = async (fileIdOrUrl: string) => {
  const { DriveClient } = await import("../../infrastructure/google/DriveClient");
  const drive = new DriveClient();
  const id = extrairIdDoDrive(fileIdOrUrl);
  if (!id) return;
  await drive.deleteFile(id);
};

// Upload
window.uploadDriveImage = async (file: File) => {
  const { DriveClient } = await import("../../infrastructure/google/DriveClient");
  const drive = new DriveClient();
  const uploaded = await drive.uploadImage(file, SHARED_FOLDER_ID);
  await drive.setPublic(uploaded.id);
  const url = DriveClient.viewUrl(uploaded.id);
  return { id: uploaded.id, url };
};

// ============================ IndexedDB ============================
const DB_NAME = "pwa-sheets-cache";
const DB_VERSION = 2; // bump por causa do store de imagens
const STORE_USERS  = "users";
const STORE_IMAGES = "images"; // blobs de foto

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
          db.createObjectStore(STORE_IMAGES, { keyPath: "key" }); // key = "id:{fotoId}" | "url:{hash(url)}"
        }
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return this.db;
  }

  async getAllUsers(): Promise<Usuario[]> {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE_USERS, "readonly");
      const st = tx.objectStore(STORE_USERS);
      const req = st.getAll();
      req.onsuccess = () => res((req.result || []).map((x: any) => x.data as Usuario));
      req.onerror = () => rej(req.error);
    });
  }

  async upsertUser(user: Usuario) {
    const db = await this.open();
    return new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE_USERS, "readwrite");
      const st = tx.objectStore(STORE_USERS);
      const key = (user.email || user.nome || "").toLowerCase() || `row_${hash(JSON.stringify(user))}`;
      st.put({ key, email: user.email || null, data: user });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  // ===== imagens
  async getImage(key: string): Promise<Blob | null> {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE_IMAGES, "readonly");
      const st = tx.objectStore(STORE_IMAGES);
      const req = st.get(key);
      req.onsuccess = () => res((req.result && req.result.blob) || null);
      req.onerror = () => rej(req.error);
    });
  }
  async putImage(key: string, blob: Blob): Promise<void> {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE_IMAGES, "readwrite");
      const st = tx.objectStore(STORE_IMAGES);
      st.put({ key, blob });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async delImage(key: string): Promise<void> {
    const db = await this.open();
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
function imgKey(u: { fotoId?: string|null; fotoUrl?: string|null }): string | null {
  if (u.fotoId) return `id:${u.fotoId}`;
  if (u.fotoUrl) return `url:${hash(u.fotoUrl)}`;
  return null;
}
async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Falha ao baixar imagem (${res.status})`);
  return await res.blob();
}

// ============================ Normalização & helpers ============================
const normalize = (rowIndex: number, obj: LinhaCadastro): Usuario => ({
  rowIndex,
  nome: obj?.Nome ?? obj?.nome ?? "",
  email: obj?.Email ?? obj?.email ?? "",
  observacoes:
    obj?.Observacoes ?? obj?.Observações ??
    obj?.observacoes ?? obj?.observações ?? "",
  fotoUrl: obj?.FotoUrl ?? obj?.fotoUrl ?? obj?.ImageUrl ?? obj?.imageUrl ?? obj?.Imagem ?? obj?.Foto ?? null,
  fotoId:  obj?.FotoId  ?? obj?.fotoId  ?? obj?.ImageId  ?? obj?.imageId  ?? null,
});

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector(sel) as T | null;

function escapeHtml(s: any) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
}
function deepClone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }
function wait(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// ============================ Estado/UI refs ============================
const db = new CacheDB();
const sheets = new SheetsClient();

let original: Usuario | null = null;
let current: Usuario | null = null;
let selectedFile: File | null = null;
let photoRemoved = false;

const alertBox = $("#alert") as HTMLDivElement | null;
const form = $("#form") as HTMLFormElement | null;

const tabEl = $("#tab") as HTMLInputElement | null;
const rowIndexEl = $("#rowIndex") as HTMLInputElement | null;

const nomeEl = $("#nome") as HTMLInputElement | null;
const emailEl = $("#email") as HTMLInputElement | null;
const obsEl = $("#observacoes") as HTMLTextAreaElement | null;

const imgDrop = $("#imgDrop") as HTMLDivElement | null;
const imgPlaceholder = $("#imgPlaceholder") as HTMLDivElement | null;
const imgPreview = $("#imgPreview") as HTMLImageElement | null;
const imgDelete = $("#imgDelete") as HTMLButtonElement | null;
const imgActions = $("#imgActions") as HTMLDivElement | null;
const inputFile = $("#imagem") as HTMLInputElement | null;
const fotoFileIdAtual = $("#fotoFileIdAtual") as HTMLInputElement | null;

// ============================ Alert/Loading ============================
function showAlert(msg: string, type: "info"|"success"|"warning"|"danger" = "warning") {
  if (!alertBox) return;
  alertBox.textContent = msg;
  alertBox.className = `alert alert-${type}`;
  alertBox.classList.remove("d-none");
}
function hideAlert() { alertBox?.classList.add("d-none"); }
function setSaving(isSaving: boolean) {
  const btns = (form?.querySelectorAll("button[type='submit']") || []) as NodeListOf<HTMLButtonElement>;
  btns.forEach(b => {
    b.disabled = isSaving;
    b.innerHTML = isSaving
      ? `<span class="spinner-border spinner-border-sm me-1"></span> Salvando...`
      : `<i class="bi bi-save"></i> Salvar`;
  });
}

// ============================ Imagem UI handlers ============================
imgDrop?.addEventListener("click", () => inputFile?.click());
($("#imgRetake") as HTMLButtonElement | null)?.addEventListener("click", () => inputFile?.click());

imgDelete?.addEventListener("click", (e) => {
  e.stopPropagation();
  photoRemoved = true;
  selectedFile = null;
  if (inputFile) inputFile.value = "";
  if (imgPreview) { imgPreview.src = ""; imgPreview.classList.add("d-none"); }
  imgPlaceholder?.classList.remove("d-none");
  imgDelete?.classList.add("d-none");
  imgActions?.classList.add("d-none");
});

inputFile?.addEventListener("change", () => {
  const file = inputFile.files && inputFile.files[0];
  if (!file) return;
  photoRemoved = false;
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    if (imgPreview) {
      imgPreview.src = String(reader.result);
      imgPreview.classList.remove("d-none");
    }
    imgPlaceholder?.classList.add("d-none");
    imgDelete?.classList.remove("d-none");
    imgActions?.classList.remove("d-none");
  };
  reader.readAsDataURL(file);
});

// ============================ Inicialização ============================
document.addEventListener("DOMContentLoaded", () => {
  loadNavbar();
  void init();
});

async function init() {
  try {
    const usp = new URLSearchParams(location.search);
    const rowIndex = Number(usp.get("rowIndex"));
    if (!Number.isFinite(rowIndex) || rowIndex < 1) {
      showAlert("rowIndex inválido.", "danger"); return;
    }

    tabEl && (tabEl.value = "Cadastro");
    rowIndexEl && (rowIndexEl.value = String(rowIndex));

    // 1) Cache-first: carrega registro + imagem do IndexedDB
    const cached = await findUserInCache(rowIndex);
    if (cached) {
      console.log("[Editar] cache → registro:", cached);
      await renderUserWithImageFromCache(cached); // foto do cache local
      original = deepClone(cached);
      current = deepClone(cached);
    } else {
      console.warn("[Editar] registro não encontrado no cache para rowIndex", rowIndex);
    }

    // 2) Metadados: alinhar local com Sheets e verificar nova versão
    const meta = await (sheets as any).upsertMetaLocal?.("Cadastro") ?? null;
    if (meta && meta.index >= 1) {
      const remoteIso = await sheets.getMetaLastModByIndexFast(meta.index);
      const changed = !!remoteIso && (!cached || remoteIso > meta.lastMod);
      console.log("[Editar] meta local:", meta, " | remoto:", remoteIso, " | changed:", changed);

      if (changed) {
        // 3) Buscar SOMENTE a linha atualizada
        const fresh = await sheets.getObjectByIndex<Record<string, any>>("Cadastro", rowIndex);
        if (fresh?.object) {
          if (isSoftDeletedRow(fresh.object)) {
            showAlert("Este registro foi excluído recentemente.", "warning");
          } else {
            const user = normalize(rowIndex, fresh.object);

            // Atualiza cache de usuários
            await updateUserInCache(user);

            // Atualiza/valida cache da IMAGEM: se mudou a key (id/url), rebaixa e grava Blob
            const changedPhoto = changedImage(current, user);
            if (changedPhoto && user.fotoUrl) {
              await cacheImageIfNeeded(user);
            }

            await renderUserWithImageFromCache(user);
            original = deepClone(user);
            current  = deepClone(user);
          }
        }
      } else if (!cached && current) {
        // se não havia cache mas conseguimos current (caso improvável), render já ocorreu
      }
    }

    if (!current) {
      showAlert("Não foi possível carregar o registro.", "danger");
    }

  } catch (e: any) {
    console.error(e);
    showAlert(e?.message || "Falha ao carregar edição.", "danger");
  }
}

// ============================ Cache helpers ============================
async function findUserInCache(rowIndex: number): Promise<Usuario | null> {
  const all = await db.getAllUsers();
  return all.find(u => u.rowIndex === rowIndex) || null;
}
async function updateUserInCache(user: Usuario) {
  await db.upsertUser(user);
}

function isSoftDeletedRow(obj: LinhaCadastro): boolean {
  const vals = Object.values(obj ?? {});
  if (!vals.length) return false;
  return vals.every(v => String(v ?? "").trim() === "-");
}

function changedImage(a: Usuario | null, b: Usuario | null): boolean {
  if (!a || !b) return true;
  return (a.fotoId ?? null) !== (b.fotoId ?? null) || (a.fotoUrl ?? null) !== (b.fotoUrl ?? null);
}

async function cacheImageIfNeeded(u: Usuario) {
  const key = imgKey(u);
  if (!key || !u.fotoUrl) return;
  const exists = await db.getImage(key);
  if (!exists) {
    try {
      const blob = await fetchBlob(u.fotoUrl);
      await db.putImage(key, blob);
      console.log("[Editar] imagem cacheada:", key);
    } catch (e) {
      console.warn("[Editar] falha ao baixar/cachear imagem:", e);
    }
  }
}

async function renderUserWithImageFromCache(u: Usuario) {
  // 1) Preenche campos
  setFormFields(u);

  // 2) Tenta foto via cache de Blob
  const key = imgKey(u);
  if (key) {
    const blob = await db.getImage(key);
    if (blob) {
      // usa blob: URL (sem bater no Drive)
      const url = URL.createObjectURL(blob);
      setImage(url, true);
      return;
    }
    // se não tem no cache mas tem URL, baixa uma vez e cacheia
    if (u.fotoUrl) {
      try {
        const b = await fetchBlob(u.fotoUrl);
        await db.putImage(key, b);
        const url = URL.createObjectURL(b);
        setImage(url, true);
        return;
      } catch (e) {
        console.warn("[Editar] falha ao baixar imagem para cache:", e);
      }
    }
  }

  // 3) Sem imagem
  setImage(null, false);
}

function setFormFields(u: Usuario) {
  nomeEl && (nomeEl.value = u.nome || "");
  emailEl && (emailEl.value = u.email || "");
  obsEl && (obsEl.value = u.observacoes || "");
  fotoFileIdAtual && (fotoFileIdAtual.value = u.fotoId || "");
}

function setImage(objUrl: string | null, has: boolean) {
  if (has && objUrl) {
    if (imgPreview) { imgPreview.src = objUrl; imgPreview.classList.remove("d-none"); }
    imgPlaceholder?.classList.add("d-none");
    imgDelete?.classList.remove("d-none");
    imgActions?.classList.remove("d-none");
  } else {
    if (imgPreview) { imgPreview.src = ""; imgPreview.classList.add("d-none"); }
    imgPlaceholder?.classList.remove("d-none");
    imgDelete?.classList.add("d-none");
    imgActions?.classList.add("d-none");
  }
}

// ============================ Form / Salvar ============================
function readForm(): Usuario {
  const rowIndex = Number(rowIndexEl?.value || 0);
  return {
    rowIndex,
    nome: nomeEl?.value?.trim() || "",
    email: emailEl?.value?.trim() || "",
    observacoes: obsEl?.value?.trim() || "",
    fotoId: fotoFileIdAtual?.value?.trim() || current?.fotoId || null,
    fotoUrl: current?.fotoUrl || null,
  };
}

function hasChanges(a: Usuario | null, b: Usuario | null): boolean {
  if (!a || !b) return true;
  return (
    a.nome !== b.nome ||
    a.email !== b.email ||
    a.observacoes !== b.observacoes ||
    a.fotoId !== b.fotoId ||
    a.fotoUrl !== b.fotoUrl ||
    selectedFile !== null ||
    photoRemoved === true
  );
}

form?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  hideAlert();

  if (!current) { showAlert("Nada para salvar.", "danger"); return; }

  const before = readForm();
  let next = deepClone(before);

  if (!hasChanges(original, next)) {
    console.log("[Editar] nenhuma alteração → voltar à consulta");
    return redirectToConsulta();
  }

  try {
    setSaving(true);
    showAlert("Salvando alterações...", "info");

    const hadOldPhotoId = !!current?.fotoId;
    const hadOldPhotoUrl = !!current?.fotoUrl;
    const oldKey = imgKey(current || {});

    // Remoção
    if (photoRemoved) {
      if ((hadOldPhotoId || hadOldPhotoUrl) && typeof window.deleteDriveFile === "function") {
        await window.deleteDriveFile(current?.fotoId || current?.fotoUrl || "");
      }
      if (oldKey) { try { await db.delImage(oldKey); } catch {} }
      next.fotoId = null;
      next.fotoUrl = null;
    }

    // Substituição
    if (selectedFile && typeof window.uploadDriveImage === "function") {
      if ((hadOldPhotoId || hadOldPhotoUrl) && typeof window.deleteDriveFile === "function") {
        await window.deleteDriveFile(current?.fotoId || current?.fotoUrl || "");
      }
      if (oldKey) { try { await db.delImage(oldKey); } catch {} }

      const up = await window.uploadDriveImage(selectedFile);
      next.fotoId = up?.id ?? null;
      next.fotoUrl = up?.url ?? null;

      // já baixa e grava a nova foto no cache (UX mais suave ao voltar para consulta/editar)
      if (next.fotoUrl) {
        const newKey = imgKey(next)!;
        try {
          const blob = await fetchBlob(next.fotoUrl);
          await db.putImage(newKey, blob);
        } catch (e) {
          console.warn("[Editar] falha ao cachear nova imagem:", e);
        }
      }
    }

    // Se após regras de foto nada mudou, retorna
    if (!hasChanges(original, next)) {
      console.log("[Editar] nenhuma alteração após regras de foto → voltar");
      return redirectToConsulta();
    }

    // Persistir no Sheets
    const rowIndex = next.rowIndex;
    const dataToUpdate: Record<string, string> = {
      "Nome": next.nome,
      "Email": next.email,
      "Observacoes": next.observacoes,
    };
    // ajuste aqui o nome do cabeçalho de URL/ID conforme sua planilha
    if (next.fotoUrl !== undefined) dataToUpdate["Imagem"] = next.fotoUrl ?? "";
    if (next.fotoId  !== undefined) dataToUpdate["FotoId"] = next.fotoId ?? "";

    console.log("[Editar] updateRowByIndex(Cadastro):", { rowIndex, dataToUpdate });
    await sheets.updateRowByIndex("Cadastro", rowIndex, dataToUpdate);

    // Metadados — APENAS Sheets
    console.log("[Editar] upsertMetaSheet('Cadastro')");
    await (sheets as any).upsertMetaSheet?.("Cadastro");

    // Atualiza cache local de usuário
    current = deepClone(next);
    original = deepClone(next);
    await updateUserInCache(current);

    showAlert("Informações atualizadas.", "success");
    await wait(800);
    redirectToConsulta();

  } catch (e: any) {
    console.error(e);
    showAlert(e?.message || "Falha ao salvar alterações.", "danger");
  } finally {
    setSaving(false);
  }
});

// ============================ Navegação ============================
function redirectToConsulta() {
  const usp = new URLSearchParams({ voltei: "1" });
  navigateTo(`src/presentation/pages/consulta.html?${usp.toString()}`);
}
