import { GoogleAuthManager } from "../../infrastructure/auth/GoogleAuthManager";

/** Tipos mínimos usados pelo cliente */
export type DriveFileLite = { id: string };
export type DriveFolderInfo = { id: string; name: string; mimeType: string; driveId?: string | null };

/**
 * DriveClient – Versão enxuta para uploads SOMENTE em Unidade Compartilhada.
 * - Não cria pastas automaticamente.
 * - Exige que o chamador forneça EXATAMENTE o ID da pasta de destino.
 * - Valida que a pasta informada pertence a uma Unidade Compartilhada.
 */
export class DriveClient {
  private readonly fields: string;

  constructor(opts: { fields?: string } = {}) {
    this.fields = opts.fields ?? "id,name,mimeType,webViewLink,webContentLink,thumbnailLink,driveId";
    console.log("[DriveClient] Inicializado com fields:", this.fields);
  }

  // ====== Auth/HTTP ======
  private async getAccessToken(): Promise<string> {
    console.log("[DriveClient] Solicitando token de acesso...");
    await GoogleAuthManager.authenticate();
    const token = GoogleAuthManager.getAccessToken();
    if (!token) throw new Error("Token de acesso inválido (Drive).");
    console.log("[DriveClient] Token de acesso obtido com sucesso.");
    return token;
  }

  private async request<T = any>(url: string, init?: RequestInit): Promise<T> {
    console.log("[DriveClient] Requisição →", url, init?.method || "GET");
    const token = await this.getAccessToken();
    const isForm = init?.body instanceof FormData;

    const sep = url.includes("?") ? "&" : "?";
    const urlWithDrives = `${url}${sep}supportsAllDrives=true&includeItemsFromAllDrives=true`;

    const res = await fetch(urlWithDrives, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        ...(init?.headers || {}),
      },
    });

    console.log("[DriveClient] Resposta status:", res.status);
    if (!res.ok) {
      let detail = "";
      try { detail = await res.text(); } catch { }
      try { const j = JSON.parse(detail); detail = j?.error?.message || detail; } catch { }
      throw new Error(`Drive ${res.status}: ${detail || res.statusText}`);
    }

    const ct = res.headers.get("content-type") || "";
    if (res.status === 204) return undefined as unknown as T;
    if (ct.includes("application/json")) {
      const data = await res.json();
      console.log("[DriveClient] Resposta JSON:", data);
      return data as T;
    }
    const txt = await res.text();
    console.log("[DriveClient] Resposta texto:", txt);
    return txt as unknown as T;
  }



  // ====== Uploads ======
  async uploadImage(file: File, sharedFolderId: string): Promise<DriveFileLite> {

    console.log("[DriveClient] Iniciando upload multipart para pasta:", sharedFolderId);

    const meta = { name: file.name, mimeType: file.type || "application/octet-stream", parents: [sharedFolderId] };
    console.log("[DriveClient] Metadados:", meta);

    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json; charset=UTF-8" }));
    form.append("file", file);

    const url = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`;
    const result = await this.request<DriveFileLite>(url, { method: "POST", body: form });
    console.log("[DriveClient] Upload concluído. ID:", result.id);
    return result;
  }

  async uploadImageResumable(file: File, sharedFolderId: string): Promise<DriveFileLite> {
    console.log("[DriveClient] Iniciando upload resumable para pasta:", sharedFolderId);

    const token = await this.getAccessToken();
    const initUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id";

    console.log("[DriveClient] Criando sessão resumable...");
    const initRes = await fetch(`${initUrl}&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ name: file.name, parents: [sharedFolderId], mimeType: file.type || "application/octet-stream" }),
    });
    if (!initRes.ok) throw new Error(`Init resumable: ${await initRes.text()}`);

    const location = initRes.headers.get("Location");
    if (!location) throw new Error("Resumable: header Location ausente.");
    console.log("[DriveClient] Sessão resumable criada. Location:", location);

    console.log("[DriveClient] Enviando chunks...");
    const putRes = await fetch(location, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
    if (!putRes.ok) throw new Error(`PUT resumable: ${await putRes.text()}`);

    const result = await putRes.json();
    console.log("[DriveClient] Upload resumable concluído. ID:", result.id);
    return result;
  }

  // ====== Permissões/URLs ======
  async setPublic(fileId: string): Promise<void> {
    console.log("[DriveClient] Tornando arquivo público:", fileId);
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`;
    await this.request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "reader", type: "anyone" }) });
    console.log("[DriveClient] Arquivo agora é público.");
  }

  async addUserPermission(fileId: string, email: string, role: "reader" | "commenter" | "writer" = "writer", sendEmail = false): Promise<void> {
    console.log(`{DriveClient] Adicionando permissão ${role} para ${email} no arquivo:`, fileId);
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=${sendEmail ? "true" : "false"}`;
    await this.request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "user", role, emailAddress: email }) });
    console.log("[DriveClient] Permissão adicionada.");
  }

  async deleteFile(fileId: string): Promise<void> {
    console.log("[DriveClient] Excluindo arquivo:", fileId);
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
    await this.request(url, { method: "DELETE" });
    console.log("[DriveClient] Arquivo excluído.");
  }

  static viewUrl(fileId: string, sizePx?: number): string {
    const url = sizePx ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=s${sizePx}` : `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`;
    console.log("[DriveClient] Gerando viewUrl:", url);
    return url;
  }

  static directUrl(fileId: string): string {
    const url = `https://drive.google.com/uc?id=${encodeURIComponent(fileId)}`;
    console.log("[DriveClient] Gerando directUrl:", url);
    return url;
  }

  static extractDriveId(value: string): string | null {
    console.log("[DriveClient] Extraindo ID do valor:", value);
    const s = (value || "").trim();
    if (!s) return null;
    if (!s.includes("://")) return s; // já é um ID
    const m1 = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);     // ...?id=<id>
    if (m1) return m1[1];
    const m2 = s.match(/\/d\/([a-zA-Z0-9_-]+)/);       // .../d/<id>/
    if (m2) return m2[1];
    const m3 = s.match(/\/download\?id=([a-zA-Z0-9_-]+)/); // .../download?id=<id>
    if (m3) return m3[1];
    return null;
  }

}
