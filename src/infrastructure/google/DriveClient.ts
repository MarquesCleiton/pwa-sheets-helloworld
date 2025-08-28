// src/infrastructure/google/DriveClient.ts
import { GoogleAuthManager } from "../auth/GoogleAuthManager";

type DriveFileLite = { id: string };
type DriveFolder = { id: string; name: string };

export class DriveClient {
  private readonly fields: string;
  private readonly appRootName: string;

  // ====== Cache (localStorage) ======
  private static readonly ROOT_CACHE_KEY = "drive:appRootId";
  private static readonly PATH_PREFIX    = "drive:path:";
  private static readonly CACHE_TTL_MS   = 24 * 60 * 60 * 1000; // 1 dia

  constructor(
    fields: string = "id,name,mimeType,webViewLink,webContentLink,thumbnailLink",
    appRootName: string = "pwa-sheets-helloworld"
  ) {
    this.fields = fields;
    this.appRootName = appRootName;
  }

  // ====== Auth/HTTP ======
  private async getAccessToken(): Promise<string> {
    await GoogleAuthManager.authenticate();
    const token = GoogleAuthManager.getAccessToken();
    if (!token) throw new Error("Token de acesso inválido (Drive).");
    return token;
  }

  /** Não force Content-Type quando body for FormData (browser define o boundary). */
  private async request<T = any>(url: string, init?: RequestInit): Promise<T> {
    const token  = await this.getAccessToken();
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

  // ====== Cache helpers ======
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

  // ====== Pastas ======
  private async findFolderInParent(parentId: string, name: string): Promise<DriveFolder | null> {
    const q = [
      `name='${name.replace(/'/g, "\\'")}'`,
      `mimeType='application/vnd.google-apps.folder'`,
      `trashed=false`,
      `'${parentId}' in parents`,
    ].join(" and ");
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;
    const r = await this.request<{ files?: DriveFolder[] }>(url);
    return (r.files || [])[0] ?? null;
  }

  private async createFolder(parentId: string, name: string): Promise<DriveFolder> {
    const url = `https://www.googleapis.com/drive/v3/files?fields=id,name`;
    return await this.request<DriveFolder>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        parents: [parentId],
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
    const found = await this.request<{ files?: DriveFolder[] }>(listUrl);
    const hit = (found.files || [])[0];
    if (hit) {
      this.setCache(DriveClient.ROOT_CACHE_KEY, hit.id);
      return hit.id;
    }

    const created = await this.createFolder("root", this.appRootName);
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

  // ====== Uploads ======
  private async findRecentByName(parentId: string, name: string, sinceMs: number) {
    const iso = new Date(sinceMs).toISOString();
    const q = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false and createdTime>'${iso}'`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&fields=files(id)&pageSize=1`;
    const r = await this.request<{ files?: DriveFileLite[] }>(url);
    return (r.files || [])[0] ?? null;
  }

  /**
   * Fast-path: multipart (1 chamada, retorna {id}).
   * Se 500, tenta recuperar por nome recém-criado; se não achar, usa resumable.
   */
  async uploadImage(file: File, parentFolderId: string): Promise<DriveFileLite> {
    const startedAt = Date.now();

    // multipart
    const meta = { name: file.name, mimeType: file.type || "application/octet-stream", parents: [parentFolderId] };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json; charset=UTF-8" }));
    form.append("file", file);

    const url = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`;
    try {
      return await this.request<DriveFileLite>(url, { method: "POST", body: form });
    } catch {
      // erro (ex.: 500) — o arquivo pode ter sido criado; tenta recuperar
      const found = await this.findRecentByName(parentFolderId, file.name, startedAt - 60_000);
      if (found) return found;

      // fallback: resumable (robusto)
      return await this.uploadImageResumable(file, parentFolderId);
    }
  }

  /** Resumable upload — estável para arquivos maiores ou rede instável (retorna {id}). */
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

  // ====== Permissões/URLs ======
  /** Torna o arquivo público (anyone → reader). */
  async setPublic(fileId: string): Promise<void> {
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`;
    await this.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
  }

  /**
   * URL estável para `<img>` vinda do host de mídia do Google.
   * Passe `sizePx` para miniaturas (ex.: 48 → `=s48`).
   */
  static viewUrl(fileId: string, sizePx?: number): string {
    return sizePx
      ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=s${sizePx}`
      : `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`;
  }

  /**
   * Se você receber uma URL completa do Drive (uc, file/d, usercontent),
   * use isto para extrair o ID e reconstruir com `viewUrl`.
   */
  static extractDriveId(value: string): string | null {
    const s = (value || "").trim();
    if (!s) return null;
    if (!s.includes("://")) return s; // já é um ID
    const m1 = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);             // uc?export=view&id=...
    if (m1) return m1[1];
    const m2 = s.match(/\/d\/([a-zA-Z0-9_-]+)/);               // /file/d/<id>/
    if (m2) return m2[1];
    const m3 = s.match(/\/download\?id=([a-zA-Z0-9_-]+)/);     // drive.usercontent.google.com/download?id=...
    if (m3) return m3[1];
    return null;
  }
}
