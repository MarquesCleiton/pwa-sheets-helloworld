// src/presentation/scripts/editar.ts
import { SheetsClient } from "../../infrastructure/google/SheetsClient";
import { GoogleAuthManager } from "../../infrastructure/auth/GoogleAuthManager";
import { DriveClient } from "../../infrastructure/google/DriveClient";

const $ = (s: string) => document.querySelector(s) as HTMLElement | null;

const show = (msg: string, type: "success" | "warning" | "danger" = "warning") => {
  const el = $("#alert") as HTMLDivElement | null;
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove("d-none");
};

/** ====== Auto-expand (altura máx + scrollbar) ====== */
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
  requestAnimationFrame(apply);
  setTimeout(apply, 100);
  return { resize: apply };
}

/* ====== Helpers de imagem (mesma UX do cadastro) ====== */
const inputFile  = $("#imagem") as HTMLInputElement | null;
const imgDrop    = $("#imgDrop") as HTMLDivElement | null;
const imgPreview = $("#imgPreview") as HTMLImageElement | null;
const imgDelete  = $("#imgDelete") as HTMLButtonElement | null;
const imgRetake  = $("#imgRetake") as HTMLButtonElement | null;
const imgActions = $("#imgActions") as HTMLDivElement | null;
const imgPh      = $("#imgPlaceholder") as HTMLDivElement | null;

function showPreview(src: string) {
  imgPh?.classList.add("d-none");
  if (imgPreview) { imgPreview.src = src; imgPreview.classList.remove("d-none"); }
  imgDelete?.classList.remove("d-none");
  imgActions?.classList.remove("d-none");
  if (imgDrop) imgDrop.style.minHeight = "220px";
}
function clearImageUi() {
  if (inputFile) inputFile.value = "";
  if (imgPreview) { imgPreview.src = ""; imgPreview.classList.add("d-none"); }
  imgDelete?.classList.add("d-none");
  imgActions?.classList.add("d-none");
  imgPh?.classList.remove("d-none");
  if (imgDrop) imgDrop.style.minHeight = "140px";
}
function wireImageUx() {
  imgDrop?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("#imgDelete")) return;
    inputFile?.click();
  });
  imgRetake?.addEventListener("click", () => inputFile?.click());
  imgDelete?.addEventListener("click", (e) => { e.stopPropagation(); clearImageUi(); });
  inputFile?.addEventListener("change", () => {
    const f = inputFile.files?.[0];
    if (!f) { clearImageUi(); return; }
    const url = URL.createObjectURL(f);
    showPreview(url);
  });
}

/** Deleta um arquivo do Drive usando o token do GoogleAuthManager (sem usar métodos privados do DriveClient). */
async function deleteDriveFile(fileId: string): Promise<void> {
  if (!fileId) return;
  await GoogleAuthManager.authenticate();
  const token = GoogleAuthManager.getAccessToken();
  if (!token) throw new Error("Token de acesso inválido para deletar arquivo.");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  // 204 = ok; se não for ok, tentamos ler texto apenas para log, mas não derrubamos o fluxo principal
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => "");
    console.warn("Falha ao deletar arquivo do Drive:", res.status, detail);
  }
}

/** Encontra cabeçalhos com tolerância a acentos/variações. */
function resolveHeaders(headers: string[]) {
  const lower = headers.map(h => h.toLowerCase());
  const findEq = (name: string) => {
    const i = lower.indexOf(name.toLowerCase());
    return i >= 0 ? headers[i] : null;
  };
  const findStarts = (prefix: string) => {
    const i = lower.findIndex(h => h.startsWith(prefix.toLowerCase()));
    return i >= 0 ? headers[i] : null;
  };
  const H_NOME  = findEq("nome")  ?? "Nome";
  const H_EMAIL = findEq("email") ?? "Email";
  const H_OBS   = findStarts("observa") ?? "Observações";
  const H_IMG   =
    findEq("imagem") ??
    findEq("foto") ??
    findEq("imagem url") ??
    findEq("imagemurl") ??
    "Imagem";
  return { H_NOME, H_EMAIL, H_OBS, H_IMG };
}

document.addEventListener("DOMContentLoaded", async () => {
  // Auth rápida (mantém padrão do projeto)
  try { await GoogleAuthManager.authenticate(); } catch {}

  const params   = new URLSearchParams(location.search);
  const tab      = params.get("tab") || "Cadastro";
  const rowIndex = Number(params.get("rowIndex") || NaN);

  const inputTab  = $("#tab") as HTMLInputElement | null;
  const inputIdx  = $("#rowIndex") as HTMLInputElement | null;
  const inputNome = $("#nome") as HTMLInputElement | null;
  const inputMail = $("#email") as HTMLInputElement | null;
  const inputObs  = $("#observacoes") as HTMLTextAreaElement | null;
  const form      = $("#form") as HTMLFormElement | null;

  const obsAuto = initAutoExpand("#observacoes", 320);
  if (inputTab) inputTab.value = tab;
  if (inputIdx) inputIdx.value = String(rowIndex);

  if (!Number.isInteger(rowIndex) || rowIndex < 1) {
    show("rowIndex inválido para edição (use >= 1).", "danger");
    return;
  }

  wireImageUx();

  const sheets = new SheetsClient();
  const drive  = new DriveClient();

  // Pasta padrão (mesma do cadastro, mas dentro do app root do DriveClient)
  const folderIdPromise = drive.ensurePath(["Cadastro", "Imagens"]);

  let headers: string[] = [];
  let currentCellValue = "";        // o que está no Sheets (URL ou ID)
  let currentFileId: string | null = null;

  // ===== Carrega registro =====
  try {
    const [row, hdrs] = await Promise.all([
      sheets.getObjectByIndex<Record<string, string>>(tab, rowIndex),
      sheets.getHeaders(tab),
    ]);
    if (!row) throw new Error("Registro não encontrado para o rowIndex informado.");
    headers = hdrs;
    const alvo = row.object;

    // Preenche campos
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
    if (inputObs)  { inputObs.value = String(observacoes); obsAuto?.resize(); }

    // Imagem atual
    const { H_IMG } = resolveHeaders(headers);
    currentCellValue = String(alvo[H_IMG] || "").trim();
    currentFileId = DriveClient.extractDriveId(currentCellValue);

    if (currentFileId) {
      showPreview(DriveClient.viewUrl(currentFileId, 320));
    } else if (currentCellValue && currentCellValue.startsWith("http")) {
      showPreview(currentCellValue);
    } else {
      clearImageUi();
    }
  } catch (e: any) {
    show(e?.message || "Erro ao carregar registro para edição.", "danger");
    return;
  }

  // ===== Salvar =====
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();

    try {
      const nome  = (inputNome?.value || "").trim();
      const email = (inputMail?.value || "").trim();
      const obs   = (inputObs?.value  || "").trim();

      if (!headers.length) headers = await sheets.getHeaders(tab);
      const { H_NOME, H_EMAIL, H_OBS, H_IMG } = resolveHeaders(headers);

      const data: Record<string, string> = {};
      if (H_NOME)  data[H_NOME]  = nome;
      if (H_EMAIL) data[H_EMAIL] = email;
      if (H_OBS)   data[H_OBS]   = obs;

      const newFile = inputFile?.files?.[0] || null;

      // Detecta "remoção" pela UI: placeholder visível e nenhum arquivo novo
      const removedByUi = !!imgPh && !imgPh.classList.contains("d-none") && !newFile;

      // Caso A: Remoção explícita (sem novo upload)
      if (removedByUi) {
        if (currentFileId) {
          await deleteDriveFile(currentFileId);
        }
        currentFileId = null;
        currentCellValue = "";
        data[H_IMG] = ""; // limpa a célula no Sheets
      }

      // Caso B: Substituição por nova imagem
      if (newFile) {
        if (!newFile.type.startsWith("image/")) throw new Error("Selecione uma imagem válida.");
        if (newFile.size > 5 * 1024 * 1024) throw new Error("Imagem muito grande (máx. 5 MB).");

        // Apaga a antiga (se houver id)
        if (currentFileId) {
          await deleteDriveFile(currentFileId);
        }

        // Upload da nova
        const folderId = await folderIdPromise;
        const uploaded = await drive.uploadImage(newFile, folderId);
        await drive.setPublic(uploaded.id);

        const stableUrl = DriveClient.viewUrl(uploaded.id);
        data[H_IMG] = stableUrl;
        currentFileId = uploaded.id;
        currentCellValue = stableUrl;
      }

      await sheets.updateRowByIndex(tab, rowIndex, data);
      show("Registro atualizado com sucesso!", "success");

      // Opcional: redirecionar após salvar
      // setTimeout(() => (window.location.href = "./consulta.html"), 700);
    } catch (e: any) {
      show(e?.message || "Erro ao salvar alterações.", "danger");
    }
  });
});
