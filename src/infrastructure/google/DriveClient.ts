// src/infrastructure/google/DriveClient.ts
import { GoogleAuthManager } from "../auth/GoogleAuthManager";

type DriveFileLite = { id: string };
type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  webContentLink?: string;
  thumbnailLink?: string;
};

export class DriveClient {
  private readonly fields: string;
  private readonly appRootName: string;

  constructor(
    fields: string = "id,name,mimeType,webViewLink,webContentLink,thumbnailLink",
    appRootName: string = "pwa-sheets-helloworld"
  ) {
    this.fields = fields;
    this.appRootName = appRootName;
  }

  // ========== Auth/HTTP ==========

  private async getAccessToken(): Promise<string> {
    await GoogleAuthManager.authenticate();
    const token = GoogleAuthManager.getAccessToken();
    if (!token) throw new Error("Token de acesso inválido (Drive).");
    return token;
  }

  /** Não force Content-Type quando body for FormData (boundary é do navegador). */
  private async request<T = any>(url: string, init?: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    const isForm = init?.body instanceof FormData;

    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        ...(init?.headers || {}),
      },
    });

    if (!res.ok) {
      let detail = "";
      try { detail = await res.text(); } catch {}
      try { const j = JSON.parse(detail); detail = j?.error?.message || detail; } catch {}
      throw new Error(`Drive ${res.status}: ${detail || res.statusText}`);
    }

    const ct = res.headers.get("content-type") || "";
    if (res.status === 204) return undefined as unknown as T;
    if (ct.includes("application/json")) return (await res.json()) as T;
    return (await res.text()) as unknown as T;
  }

  // ========== Cache simples (localStorage) ==========

  private static readonly ROOT_CACHE_KEY = "drive:appRootId";
  private static readonly PATH_PREFIX = "drive:path:";
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 dia

  private getCache(key: string): string | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { id, ts } = JSON.parse(raw);
      if (Date.now() - Number(ts) > DriveClient.CACHE_TTL_MS) return null;
      return id as string;
    } catch { return null; }
  }
  private setCache(key: string, id: string) {
    try { localStorage.setItem(key, JSON.stringify({ id, ts: Date.now() })); } catch {}
  }

  // ========== Pastas ==========

  private async findFolderInParent(parentId: string, name: string) {
    const q = [
      `name='${name.replace(/'/g, "\\'")}'`,
      `mimeType='application/vnd.google-apps.folder'`,
      `trashed=false`,
      `'${parentId}' in parents`,
    ].join(" and ");
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;
    const r = await this.request<{ files?: { id: string; name: string }[] }>(url);
    return (r.files || [])[0] ?? null;
  }

  private async createFolder(parentId: string, name: string) {
    const url = `https://www.googleapis.com/drive/v3/files?fields=id,name`;
    return await this.request<{ id: string; name: string }>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, parents: [parentId],
        mimeType: "application/vnd.google-apps.folder",
      }),
    });
  }

  /** Garante a pasta raiz fixa do app. */
  async ensureAppRoot(): Promise<string> {
    const cached = this.getCache(DriveClient.ROOT_CACHE_KEY);
    if (cached) return cached;

    const q = [
      `name='${this.appRootName.replace(/'/g, "\\'")}'`,
      `mimeType='application/vnd.google-apps.folder'`,
      `trashed=false`,
      `'root' in parents`,
    ].join(" and ");
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;
    const found = await this.request<{ files?: { id: string; name: string }[] }>(listUrl);
    const hit = (found.files || [])[0];
    if (hit) {
      this.setCache(DriveClient.ROOT_CACHE_KEY, hit.id);
      return hit.id;
    }

    const createUrl = `https://www.googleapis.com/drive/v3/files?fields=id,name`;
    const created = await this.request<{ id: string; name: string }>(createUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: this.appRootName,
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"],
      }),
    });

    this.setCache(DriveClient.ROOT_CACHE_KEY, created.id);
    return created.id;
  }

  /** Garante um caminho dentro da raiz do app. Ex.: "Cadastro/Imagens" */
  async ensurePath(subpath: string | string[]): Promise<string> {
    const rootId = await this.ensureAppRoot();
    const parts = (Array.isArray(subpath) ? subpath : subpath.split("/"))
      .map(s => s.trim()).filter(Boolean);

    let parent = rootId;
    let acc: string[] = [];
    for (const seg of parts) {
      acc.push(seg);
      const cacheKey = `${DriveClient.PATH_PREFIX}${this.appRootName}/${acc.join("/")}`;
      const cached = this.getCache(cacheKey);
      if (cached) { parent = cached; continue; }

      const found = await this.findFolderInParent(parent, seg);
      if (found) {
        this.setCache(cacheKey, found.id);
        parent = found.id;
        continue;
      }
      const created = await this.createFolder(parent, seg);
      this.setCache(cacheKey, created.id);
      parent = created.id;
    }
    return parent;
  }

  // ========== Uploads ==========

  private async findRecentByName(parentId: string, name: string, sinceMs: number) {
    const iso = new Date(sinceMs).toISOString();
    const q = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false and createdTime>'${iso}'`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&fields=files(id)&pageSize=1`;
    const r = await this.request<{ files?: DriveFileLite[] }>(url);
    return (r.files || [])[0] ?? null;
  }

  /** Caminho rápido: multipart (1 chamada). Se 500, tenta recuperar por nome; se não achar, cai para resumable. */
  async uploadImage(file: File, parentFolderId: string): Promise<DriveFileLite> {
    const startedAt = Date.now();

    // multipart fast-path
    const meta = { name: file.name, mimeType: file.type || "application/octet-stream", parents: [parentFolderId] };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json; charset=UTF-8" }));
    form.append("file", file);

    const url = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`;
    try {
      return await this.request<DriveFileLite>(url, { method: "POST", body: form });
    } catch {
      // 500? o arquivo pode ter sido criado; tenta recuperar
      const found = await this.findRecentByName(parentFolderId, file.name, startedAt - 60_000);
      if (found) return found;

      // fallback super estável
      return await this.uploadImageResumable(file, parentFolderId);
    }
  }

  /** Resumable upload — robusto para arquivos maiores ou redes instáveis. */
  async uploadImageResumable(file: File, parentFolderId: string): Promise<DriveFileLite> {
    const token = await this.getAccessToken();

    const initRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          name: file.name,
          parents: [parentFolderId],
          mimeType: file.type || "application/octet-stream",
        }),
      }
    );
    if (!initRes.ok) throw new Error(`Init resumable: ${await initRes.text()}`);
    const location = initRes.headers.get("Location");
    if (!location) throw new Error("Resumable: header Location ausente.");

    const putRes = await fetch(location, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!putRes.ok) throw new Error(`PUT resumable: ${await putRes.text()}`);
    return await putRes.json();
  }

  // ========== Permissões/URLs ==========

  /** Torna o arquivo público para leitura (anyone → reader). */
  async setPublic(fileId: string): Promise<void> {
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`;
    await this.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
  }

  /** URL direta para usar em <img>. Requer setPublic antes. */
  static viewUrl(fileId: string): string {
    return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`;
  }
}
