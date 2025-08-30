import { SheetsClient } from "../../infrastructure/google/SheetsClient";
import { DriveClient } from "../../infrastructure/google/DriveClient";
import { loadNavbar } from "../../shared/loadNavbar";

// ====== CONFIG ======
const SHARED_FOLDER_ID = "1zId11Ydti8d0FOQoQjd9lQmPo6GiJx26"; // Pasta fixa
const TAB = "Cadastro";
const HOME = (import.meta as any)?.env?.BASE_URL ? `${(import.meta as any).env.BASE_URL}` : "/";

// ====== Helper ======
const $ = <T extends Element = HTMLElement>(sel: string) =>
  document.querySelector<T>(sel);

// ====== Elementos ======
const form        = $<HTMLFormElement>("#cadastroForm");
const inputNome   = $<HTMLInputElement>("#nome");
const inputMail   = $<HTMLInputElement>("#email");
const inputObs    = $<HTMLTextAreaElement>("#obs");

const inputFile   = $<HTMLInputElement>("#imagem");
const imgDrop     = $<HTMLDivElement>("#imgDrop");
const imgPreview  = $<HTMLImageElement>("#imgPreview");
const imgDelete   = $<HTMLButtonElement>("#imgDelete");
const imgRetake   = $<HTMLButtonElement>("#imgRetake");
const imgActions  = $<HTMLDivElement>("#imgActions");
const imgPh       = $<HTMLDivElement>("#imgPlaceholder");

const alertBox    = $<HTMLDivElement>("#authAlert");
const statusBox   = $<HTMLDivElement>("#status");
const btnSalvar   = $<HTMLButtonElement>("#btnSalvar");
const btnSair     = $<HTMLButtonElement>("#btnSair");

// ====== Navbar ======
document.addEventListener("DOMContentLoaded", () => {
  loadNavbar();
  console.log("[Cadastro] Navbar carregada.");
});

// ====== Alert/Status ======
function showAlert(msg: string, type: "success" | "warning" | "danger" = "warning") {
  if (!alertBox) return;
  alertBox.className = `alert alert-${type}`;
  alertBox.textContent = msg;
  alertBox.classList.remove("d-none");
  console.log("[Cadastro] ALERT:", type, msg);
}
function clearAlert() { alertBox?.classList.add("d-none"); }
function setStatus(msg: string) { if (statusBox) statusBox.textContent = msg; console.log("[Cadastro] STATUS:", msg); }

// ====== UI Imagem ======
function showPreview(src: string) {
  imgPh?.classList.add("d-none");
  if (imgPreview) { imgPreview.src = src; imgPreview.classList.remove("d-none"); }
  imgDelete?.classList.remove("d-none");
  imgActions?.classList.remove("d-none");
  if (imgDrop) imgDrop.style.minHeight = "220px";
}
function clearImage() {
  if (inputFile) inputFile.value = "";
  if (imgPreview) { imgPreview.src = ""; imgPreview.classList.add("d-none"); }
  imgDelete?.classList.add("d-none");
  imgActions?.classList.add("d-none");
  imgPh?.classList.remove("d-none");
  if (imgDrop) imgDrop.style.minHeight = "140px";
}

// Clique em toda a área abre o seletor
imgDrop?.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("#imgDelete")) return;
  inputFile?.click();
});
imgRetake?.addEventListener("click", () => inputFile?.click());
imgDelete?.addEventListener("click", (e) => { e.stopPropagation(); clearImage(); });
inputFile?.addEventListener("change", () => {
  const f = inputFile.files?.[0];
  if (!f) { clearImage(); return; }
  const url = URL.createObjectURL(f);
  showPreview(url);
  console.log("[Cadastro] Preview atualizado:", { name: f.name, type: f.type, size: f.size });
});

// ====== Botão Sair ======
btnSair?.addEventListener("click", () => {
  console.log("[Cadastro] Logout");
  try { localStorage.removeItem("user"); localStorage.removeItem("accessToken"); } catch {}
  window.location.href = `${HOME}index.html`;
});

// ====== Upload + Sheets ======
const drive = new DriveClient();
let inFlight = false;

form?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (inFlight) return;
  inFlight = true;

  clearAlert();
  setStatus("");

  const sheets = new SheetsClient();

  if (btnSalvar) {
    btnSalvar.disabled = true;
    btnSalvar.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Salvando…';
  }

  try {
    const nome  = (inputNome?.value || "").trim();
    const email = (inputMail?.value || "").trim();
    const obs   = (inputObs?.value || "").trim();

    if (!nome || !email) {
      showAlert("Preencha Nome e E-mail.", "warning");
      return;
    }

    setStatus("Carregando cabeçalhos…");
    const headers = await sheets.getHeaders(TAB);

    // Upload da imagem
    const file = inputFile?.files?.[0] || null;
    let imagemURL = "";

    if (file) {
      if (!file.type.startsWith("image/")) throw new Error("Selecione uma imagem válida.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Imagem muito grande (máx. 5 MB).");

      setStatus("Enviando imagem…");
      const uploaded = await drive.uploadImage(file, SHARED_FOLDER_ID);
      await drive.setPublic(uploaded.id);
      imagemURL = DriveClient.viewUrl(uploaded.id);
    }

    // Mapeia por cabeçalho
    const lower = headers.map(h => String(h || "").toLowerCase());
    const findHeader = (target: string) => {
      const i = lower.indexOf(target.toLowerCase());
      return i >= 0 ? headers[i] : null;
    };

    const data: Record<string, string> = {};
    const hNome  = findHeader("Nome");  if (hNome)  data[hNome]  = nome;
    const hEmail = findHeader("Email"); if (hEmail) data[hEmail] = email;
    const hObs   = findHeader("Observações") || findHeader("Observacoes");
    if (hObs) data[hObs] = obs;
    const hImg   = findHeader("Imagem");
    if (hImg && imagemURL) data[hImg] = imagemURL;

    setStatus("Gravando cadastro…");
    await sheets.appendRowByHeader(TAB, data);
    await sheets.upsertMetaSheet(TAB);

    showAlert("Cadastro criado com sucesso!", "success");
    setStatus("Cadastro criado com sucesso!");
    clearImage();
    form?.reset();
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.error("[Cadastro] Erro:", err);
    showAlert(err?.message || "Erro ao salvar cadastro.", "danger");
    setStatus("");
  } finally {
    inFlight = false;
    if (btnSalvar) {
      btnSalvar.disabled = false;
      btnSalvar.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Salvar';
    }
  }
});
