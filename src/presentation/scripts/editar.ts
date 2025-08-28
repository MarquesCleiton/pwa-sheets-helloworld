// src/presentation/scripts/editar.ts
import { GoogleAuthManager } from "../../infrastructure/auth/GoogleAuthManager";
import { SheetsClient, MetaLocalEntry, MetaLocalMap } from "../../infrastructure/google/SheetsClient";
import { DriveClient } from "../../infrastructure/google/DriveClient";

/** ==================== Const / Types ==================== */
type Registro = { [k: string]: any } & {
  rowIndex: number;
  Nome?: string;
  Email?: string;
  Observações?: string;
  Observacoes?: string;
  Imagem?: string; // pode ser id, url, etc.
  Foto?: string;
};

const DB_NAME = "pwa-rpg-cache";
const DB_VERSION = 1;
const STORE_VERSIONS = "versions";
const STORE_CADASTRO = "cadastro";
const STORE_IMAGES = "images";

const COLS = {
  nome: "Nome",
  email: "Email",
  obs: "Observações", // aceitaremos Observacoes também ao ler
  fotoFileId: "Imagem", // coluna onde você guarda o ID/URL
};

function $(s: string) { return document.querySelector(s) as HTMLElement | null; }
function qi<T extends HTMLElement = HTMLElement>(s: string) { return document.querySelector(s) as T | null; }

function setAlert(kind: "success" | "danger" | "warning", msg: string) {
  const box = $("#alert") as HTMLDivElement | null;
  if (!box) return;
  box.className = `alert alert-${kind}`;
  box.textContent = msg;
  box.classList.remove("d-none");
  setTimeout(() => box.classList.add("d-none"), 4500);
}

function getParam(name: string): string | null {
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

function trim(s: any) { return (s ?? "").toString().trim(); }
function same(a?: string | null, b?: string | null) { return (a ?? "") === (b ?? ""); }

function isLikelyDriveId(id: string | null | undefined): boolean {
  return !!id && /^[A-Za-z0-9_-]{10,}$/.test(id);
}
function driveKeyFromAny(v: string | null | undefined): string | null {
  const raw = trim(v);
  if (!raw) return null;
  const id = DriveClient.extractDriveId(raw);
  if (isLikelyDriveId(id)) return `drive:${id!}`;
  return raw.includes("://") ? raw : null;
}

/** ==================== IndexedDB helpers ==================== */
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

async function getRowFromIDB(rowIndex: number): Promise<Registro | null> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_CADASTRO, "readonly");
    const rq = tx.objectStore(STORE_CADASTRO).get(rowIndex);
    rq.onsuccess = () => res((rq.result as Registro) ?? null);
    rq.onerror = () => rej(rq.error);
  });
}
async function putRowToIDB(row: Registro): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_CADASTRO, "readwrite");
    tx.objectStore(STORE_CADASTRO).put(row);
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

async function fetchDriveImageBlob(fileId: string): Promise<Blob> {
  await GoogleAuthManager.authenticate();
  const token = GoogleAuthManager.getAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive media ${res.status}`);
  return await res.blob();
}

/** ==================== UI refs ==================== */
const tabInput = qi<HTMLInputElement>("#tab");
const rowIndexInput = qi<HTMLInputElement>("#rowIndex");
const nomeInput = qi<HTMLInputElement>("#nome");
const emailInput = qi<HTMLInputElement>("#email");
const obsInput = qi<HTMLTextAreaElement>("#observacoes");

const fotoInput = qi<HTMLInputElement>("#imagem");
const fotoPreview = qi<HTMLImageElement>("#imgPreview");
const fotoPlaceholder = $("#imgPlaceholder");
const fotoDeleteBtn = qi<HTMLButtonElement>("#imgDelete");
const fotoRetakeBtn = qi<HTMLButtonElement>("#imgRetake");
const fotoActions = $("#imgActions");
const imgDrop = $("#imgDrop");

const fotoFileIdAtualHidden = qi<HTMLInputElement>("#fotoFileIdAtual");
const form = qi<HTMLFormElement>("#form");

/** ==================== Estado de imagem ==================== */
let removerFoto = false;
let novoArquivo: File | null = null;

/** ==================== Render helpers ==================== */
function setPreviewHidden(hide: boolean) {
  if (!fotoPreview || !fotoPlaceholder || !fotoDeleteBtn || !fotoActions) return;
  fotoPreview.classList.toggle("d-none", hide);
  fotoPlaceholder.classList.toggle("d-none", !hide);
  fotoDeleteBtn.classList.toggle("d-none", hide);
  fotoActions.classList.toggle("d-none", hide);
}

async function showImageFromAnyValue(v: string | null | undefined) {
  if (!fotoPreview || !fotoPlaceholder || !fotoDeleteBtn || !fotoActions) return;
  const key = driveKeyFromAny(v);
  if (!key) {
    setPreviewHidden(true);
    return;
  }
  const cached = await getImageBlob(key);
  if (cached) {
    fotoPreview.src = URL.createObjectURL(cached);
    setPreviewHidden(false);
    return;
  }
  try {
    if (key.startsWith("drive:")) {
      const blob = await fetchDriveImageBlob(key.slice(6));
      await putImageBlob(key, blob);
      fotoPreview.src = URL.createObjectURL(blob);
      setPreviewHidden(false);
      return;
    }
    // HTTP/HTTPS
    const res = await fetch(key);
    if (res.ok) {
      const blob = await res.blob();
      await putImageBlob(key, blob);
      fotoPreview.src = URL.createObjectURL(blob);
      setPreviewHidden(false);
      return;
    }
  } catch {}
  // fallback: tenta URL estável (caso só tenhamos id)
  const id = DriveClient.extractDriveId(trim(v));
  if (isLikelyDriveId(id)) {
    fotoPreview.src = DriveClient.viewUrl(id!, 256);
    setPreviewHidden(false);
    return;
  }
  setPreviewHidden(true);
}

/** ==================== Carregar/Salvar ==================== */
const sheets = new SheetsClient();
const drive = new DriveClient();

async function loadLocalFirstThenValidate() {
  const tab = getParam("tab") || "Cadastro";
  const rowIndex = Number(getParam("rowIndex") || NaN);
  if (tabInput) tabInput.value = tab;
  if (rowIndexInput) rowIndexInput.value = String(rowIndex);

  if (!Number.isInteger(rowIndex) || rowIndex < 1) {
    setAlert("danger", "Parâmetros inválidos (rowIndex precisa ser >= 1).");
    return;
  }

  // 1) Local first
  let localRow = await getRowFromIDB(rowIndex);
  if (localRow) {
    console.log("[editar] carregando do cache local");
    populateForm(localRow);
  } else {
    console.log("[editar] não há cache local para a linha; exibindo vazio até validar…");
  }

  // 2) Validar versão (fast-path em Metadados!B{linha})
  let metaLocal: MetaLocalMap = sheets.getMetaLocal();
  let entry: MetaLocalEntry | undefined = metaLocal["Cadastro"];
  if (!entry) {
    console.log("[meta] não há entrada local; construindo meta local…");
    metaLocal = await sheets.buildMetaLocalFromSheet();
    entry = metaLocal["Cadastro"];
  }

  const localVer = await getLocalVersion("Cadastro");
  let remoteVer: string | null = null;
  let needNetwork = false;

  if (entry && Number.isInteger(entry.index) && entry.index >= 1) {
    try {
      remoteVer = await sheets.getMetaLastModByIndexFast(entry.index);
      console.log("[meta] remoto (fast) =", remoteVer, "(linha", entry.index, ")");
      needNetwork = (remoteVer == null) || (remoteVer !== localVer);
    } catch (e) {
      console.warn("[meta] fast-path falhou; usando valor local do meta:", e);
      remoteVer = entry.lastMod || null;
      needNetwork = (remoteVer == null) || (remoteVer !== localVer);
    }
  } else {
    needNetwork = true;
  }

  console.log("[editar] needNetwork:", needNetwork, "localVer:", localVer, "remoteVer:", remoteVer);

  // 3) Se divergente (ou sem cache), busca do Sheets só a linha
  if (needNetwork || !localRow) {
    try {
      await GoogleAuthManager.authenticate();
      const r = await sheets.getObjectByIndex<Record<string, string>>("Cadastro", rowIndex);
      if (!r) {
        setAlert("warning", "Registro não encontrado no Sheets.");
        return;
      }
      const obj = { rowIndex: r.rowIndex, ...(r.object || {}) } as Registro;
      console.log("[editar] linha atualizada do Sheets:", obj);
      await putRowToIDB(obj);

      // cache da imagem
      const key = driveKeyFromAny(obj[COLS.fotoFileId] ?? obj["Foto"]);
      if (key && !(await getImageBlob(key))) {
        try {
          if (key.startsWith("drive:")) {
            const blob = await fetchDriveImageBlob(key.slice(6));
            await putImageBlob(key, blob);
          } else {
            const res = await fetch(key);
            if (res.ok) await putImageBlob(key, await res.blob());
          }
        } catch {}
      }

      populateForm(obj);
      if (remoteVer) {
        await setLocalVersion("Cadastro", remoteVer);
        console.log("[meta] version local atualizada para:", remoteVer);
      } else {
        // se não conseguimos o remoto, garanta consistência criando/atualizando o metadado
        const up = await sheets.upsertMeta("Cadastro");
        await setLocalVersion("Cadastro", up.lastMod);
      }
    } catch (e: any) {
      console.error(e);
      if (!localRow) setAlert("danger", "Falha ao carregar o registro.");
    }
  }
}

function populateForm(reg: Registro) {
  if (nomeInput) nomeInput.value = trim(reg[COLS.nome] ?? reg["nome"]);
  if (emailInput) emailInput.value = trim(reg[COLS.email] ?? reg["email"]);
  if (obsInput) obsInput.value = trim(reg[COLS.obs] ?? reg["Observacoes"] ?? reg["observacoes"]);
  const cur = trim(reg[COLS.fotoFileId] ?? reg["Foto"]);
  if (fotoFileIdAtualHidden) fotoFileIdAtualHidden.value = cur;
  showImageFromAnyValue(cur);
}

/** ==================== Eventos de imagem ==================== */
imgDrop?.addEventListener("click", () => fotoInput?.click());
fotoRetakeBtn?.addEventListener("click", () => fotoInput?.click());

fotoDeleteBtn?.addEventListener("click", () => {
  removerFoto = true;
  novoArquivo = null;
  if (fotoInput) fotoInput.value = "";
  setPreviewHidden(true);
  setAlert("warning", "A foto será removida ao salvar.");
});

fotoInput?.addEventListener("change", () => {
  removerFoto = false;
  const f = (fotoInput.files?.[0] as File | undefined) || null;
  novoArquivo = f;
  if (f && fotoPreview) {
    const reader = new FileReader();
    reader.onload = () => {
      fotoPreview.src = String(reader.result);
      setPreviewHidden(false);
    };
    reader.readAsDataURL(f);
  } else {
    // restaurar preview da atual se existir
    const cur = fotoFileIdAtualHidden?.value || "";
    showImageFromAnyValue(cur);
  }
});

/** ==================== Submit (upload/substituição/remoção) ==================== */
form?.addEventListener("submit", async (ev) => {
  ev.preventDefault();

  const tab = getParam("tab") || "Cadastro";
  const rowIndex = Number(getParam("rowIndex") || NaN);
  if (!Number.isInteger(rowIndex) || rowIndex < 1) {
    setAlert("danger", "Parâmetros inválidos (rowIndex precisa ser >= 1).");
    return;
  }

  const novoNome = trim(nomeInput?.value);
  const novoEmail = trim(emailInput?.value);
  const novasObs = trim(obsInput?.value);

  const valorAntigo = fotoFileIdAtualHidden?.value || "";
  const fileIdAntigo = DriveClient.extractDriveId(valorAntigo) || "";

  const atualizado: Record<string, string> = {
    [COLS.nome]: novoNome,
    [COLS.email]: novoEmail,
    [COLS.obs]: novasObs,
    [COLS.fotoFileId]: valorAntigo, // default: mantém
  };

  try {
    await GoogleAuthManager.authenticate();

    // === IMAGEM ===
    // 1) remoção explícita
    if (removerFoto && fileIdAntigo) {
      try { await (drive as any).deleteFile?.(fileIdAntigo); } catch {}
      atualizado[COLS.fotoFileId] = "";
    }

    // 2) substituição por novo upload
    if (novoArquivo) {
      // se havia antiga e não foi marcada remoção, ainda assim apagamos a antiga
      if (fileIdAntigo && !removerFoto) {
        try { await (drive as any).deleteFile?.(fileIdAntigo); } catch {}
      }

      const pastaImagens = await drive.ensurePath(["pwa-sheets-helloworld", "Cadastro", "Imagens"]);
      const uploaded = await drive.uploadImage(novoArquivo, pastaImagens);
      try { await drive.setPublic(uploaded.id); } catch {}

      atualizado[COLS.fotoFileId] = uploaded.id;
    }

    // === Atualiza a linha no Sheets ===
    await sheets.updateRowByIndex(tab, rowIndex, atualizado);

    // === Atualiza Metadados e versão local ===
    const meta = await sheets.upsertMeta("Cadastro");
    await setLocalVersion("Cadastro", meta.lastMod);

    // === Atualiza IndexedDB do registro ===
    const rowLocal: Registro = {
      rowIndex,
      [COLS.nome]: novoNome,
      [COLS.email]: novoEmail,
      [COLS.obs]: novasObs,
      [COLS.fotoFileId]: atualizado[COLS.fotoFileId],
    };
    await putRowToIDB(rowLocal);

    // === Cache de imagem (IDB images) ===
    const oldKey = driveKeyFromAny(valorAntigo);
    const newKey = driveKeyFromAny(atualizado[COLS.fotoFileId]);

    if (!same(oldKey, newKey)) {
      if (oldKey) { try { await deleteImageBlob(oldKey); } catch {} }
      if (newKey) {
        try {
          if (newKey.startsWith("drive:")) {
            const b = await fetchDriveImageBlob(newKey.slice(6));
            await putImageBlob(newKey, b);
          } else {
            const r = await fetch(newKey);
            if (r.ok) await putImageBlob(newKey, await r.blob());
          }
        } catch {}
      }
    }

    setAlert("success", "Registro atualizado com sucesso!");
    setTimeout(() => (window.location.href = "./consulta.html"), 700);
  } catch (e: any) {
    console.error(e);
    setAlert("danger", "Falha ao salvar as alterações.");
  }
});

/** ==================== Boot ==================== */
document.addEventListener("DOMContentLoaded", async () => {
  try { await GoogleAuthManager.authenticate(); } catch {}
  await loadLocalFirstThenValidate();
});
