import { SheetsClient } from "../../infrastructure/google/SheetsClient";
import { DriveClient } from "../../infrastructure/google/DriveClient";
import { loadNavbar } from "../../shared/loadNavbar";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector(sel) as T | null;

const form        = $("#cadastroForm") as HTMLFormElement | null;
const inputNome   = $("#nome") as HTMLInputElement | null;
const inputMail   = $("#email") as HTMLInputElement | null;
const inputObs    = $("#obs") as HTMLTextAreaElement | null;

// imagem (AppSheet-like)
const inputFile   = $("#imagem") as HTMLInputElement | null;
const imgDrop     = $("#imgDrop") as HTMLDivElement | null;
const imgPreview  = $("#imgPreview") as HTMLImageElement | null;
const imgDelete   = $("#imgDelete") as HTMLButtonElement | null;
const imgRetake   = $("#imgRetake") as HTMLButtonElement | null;
const imgActions  = $("#imgActions") as HTMLDivElement | null;
const imgPh       = $("#imgPlaceholder") as HTMLDivElement | null;

const alertBox    = $("#authAlert") as HTMLDivElement | null;
const statusBox   = $("#status") as HTMLDivElement | null;
const btnSalvar   = $("#btnSalvar") as HTMLButtonElement | null;

function showAlert(msg: string, type: "success" | "warning" | "danger" = "warning") {
  if (!alertBox) return;
  alertBox.className = `alert alert-${type}`;
  alertBox.textContent = msg;
  alertBox.classList.remove("d-none");
}
function clearAlert() { alertBox?.classList.add("d-none"); }
function setStatus(msg: string) { if (statusBox) statusBox.textContent = msg; }

// ====== UI de imagem ======
function showPreview(src: string) {
  imgPh?.classList.add("d-none");
  if (imgPreview) { imgPreview.src = src; imgPreview.classList.remove("d-none"); }
  imgDelete?.classList.remove("d-none");
  imgActions?.classList.remove("d-none");
  // aumenta um pouco a área quando tem preview
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

document.addEventListener("DOMContentLoaded", () => {
  loadNavbar();
  // Clique em toda a área abre o seletor
  imgDrop?.addEventListener("click", (e) => {
    // Se clicou no X, não abra file picker
    if ((e.target as HTMLElement).closest("#imgDelete")) return;
    inputFile?.click();
  });

  // Retake = abrir seletor de arquivos novamente
  imgRetake?.addEventListener("click", () => inputFile?.click());

  // Exclusão = limpar tudo
  imgDelete?.addEventListener("click", (e) => {
    e.stopPropagation();
    clearImage();
  });

  // Ao escolher arquivo, mostra preview
  inputFile?.addEventListener("change", () => {
    const f = inputFile.files?.[0];
    if (!f) { clearImage(); return; }
    const url = URL.createObjectURL(f);
    showPreview(url);
  });

  // Botão sair (ajuste conforme seu fluxo)
  const btnSair = document.getElementById("btnSair") as HTMLButtonElement | null;
  btnSair?.addEventListener("click", () => {
    try { localStorage.removeItem("user"); localStorage.removeItem("accessToken"); } catch {}
    window.location.href = "/index.html";
  });
});

// ====== Upload otimizado ======
const drive = new DriveClient();
// cache do caminho (reduz chamadas)
const folderIdPromise = drive.ensurePath(["Cadastro", "Imagens"]);

let inFlight = false;

form?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (inFlight) return;
  inFlight = true;

  clearAlert();
  setStatus("");

  const TAB = "Cadastro";
  const sheets = new SheetsClient();

  // desabilita botão
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

    // paraleliza headers e pasta
    const [headers, folderId] = await Promise.all([
      sheets.getHeaders(TAB),
      folderIdPromise,
    ]);

    // só faz upload se há arquivo
    const file = inputFile?.files?.[0] || null;
    let imagemURL = "";

    if (file) {
      // validações
      if (!file.type.startsWith("image/")) throw new Error("Selecione uma imagem válida.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Imagem muito grande (máx. 5 MB).");

      setStatus("Enviando imagem…");
      const uploaded = await drive.uploadImage(file, folderId); // fast-path; tem fallback interno
      await drive.setPublic(uploaded.id);
      imagemURL = DriveClient.viewUrl(uploaded.id);
    }

    // mapeia pelos cabeçalhos reais
    const lower = headers.map(h => h.toLowerCase());
    const findHeader = (target: string) => {
      const i = lower.indexOf(target.toLowerCase());
      return i >= 0 ? headers[i] : null;
    };

    const data: Record<string, string> = {};
    const hNome  = findHeader("Nome");           if (hNome)  data[hNome]  = nome;
    const hEmail = findHeader("Email");          if (hEmail) data[hEmail] = email;
    const hObs   = findHeader("Observações") || findHeader("Observacoes");
    if (hObs) data[hObs] = obs;

    const hImg   = findHeader("Imagem");
    if (hImg && imagemURL) data[hImg] = imagemURL;

    setStatus("Gravando cadastro…");
    await sheets.appendRowByHeader(TAB, data);

    showAlert("Cadastro criado com sucesso!", "success");
    setStatus("Cadastro criado com sucesso!");

    // opcional: limpar imagem e manter UX do bloco AppSheet
    // clearImage();
    // form?.reset();
  } catch (e: unknown) {
    const err = e as { message?: string };
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
