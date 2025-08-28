import { GoogleAuthManager } from "../auth/GoogleAuthManager";

/** ========================= TYPEs ========================= */
export type MetaRow = { SheetName: string; UltimaModificacao: string };
export type MetaLocalEntry = { index: number; sheetName: string; lastMod: string };
export type MetaLocalMap = Record<string, MetaLocalEntry>; // chave = sheetName (ex.: "Cadastro")

/** ========================= CLIENT ========================= */
export class SheetsClient {
  private readonly sheetId: string;

  // Metadados: estrutura fixa (A=SheetName, B=UltimaModificacao)
  static readonly META_TAB = "Metadados";
  private static readonly META_LASTMOD_COL = "B";

  // Cache local (localStorage)
  private static readonly META_CACHE_KEY = "sheets:metaLocalMap";
  private static readonly META_HEADERS_KEY = "sheets:metaHeaders"; // {sheetNameIdx, lastModIdx}

  constructor(sheetId: string = "19B2aMGrajvhPJfOvYXt059-fECytaN38iFsP8GInD_g") {
    this.sheetId = sheetId;
  }

  /** =============== Auth / HTTP helpers =============== */
  private async getAccessToken(): Promise<string> {
    await GoogleAuthManager.authenticate();
    const token = GoogleAuthManager.getAccessToken();
    if (!token) throw new Error("Token de acesso inválido ou ausente.");
    return token;
  }

  private async getHeadersInit(): Promise<HeadersInit> {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private async request<T = any>(url: string, method: string = "GET", body?: any): Promise<T> {
    const headers = await this.getHeadersInit();
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });

    if (!res.ok) {
      let payload: any = {};
      try { payload = await res.json(); } catch { }
      throw new Error(payload?.error?.message || `Sheets HTTP ${res.status}`);
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      try {
        const text = await res.text();
        return (text ? (JSON.parse(text) as T) : (undefined as unknown as T));
      } catch {
        return undefined as unknown as T;
      }
    }
    return (await res.json()) as T;
  }

  /** =============== Leitura geral =============== */
  private colToA1(n: number): string {
    let s = "", x = n;
    while (x >= 0) { s = String.fromCharCode((x % 26) + 65) + s; x = Math.floor(x / 26) - 1; }
    return s;
  }

  async getSheetMatrix(sheetName: string): Promise<string[][]> {
    const range = encodeURIComponent(sheetName);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${range}?majorDimension=ROWS`;
    const res = await this.request<{ values?: string[][] }>(url, "GET");
    return res.values ?? [];
  }

  async getHeaders(sheetName: string): Promise<string[]> {
    const matrix = await this.getSheetMatrix(sheetName);
    if (matrix.length === 0) return [];
    const headersRaw = matrix[0] ?? [];
    return headersRaw.map((h, i) => {
      const k = String(h ?? "").trim();
      return k.length ? k : `col_${i + 1}`;
    });
  }

  private async getRowArrayByIndex(sheetName: string, rowIndex: number): Promise<string[] | null> {
    const headers = await this.getHeaders(sheetName);
    if (headers.length === 0) return null;
    const lastColA1 = this.colToA1(headers.length - 1);
    const a1 = `${sheetName}!A${rowIndex + 1}:${lastColA1}${rowIndex + 1}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(a1)}?majorDimension=ROWS`;
    const data = await this.request<{ values?: string[][] }>(url, "GET");
    const row = data.values?.[0] ?? [];
    const allEmpty = row.length === 0 || row.every(c => c === "" || c == null);
    return allEmpty ? null : row.map(v => (v ?? "").toString());
  }

  private mapObjectToRow(obj: Record<string, string>, headers: string[]): string[] {
    return headers.map(header => obj[header] ?? "");
  }

  /** append retornando o rowIndex 0-based da linha criada */
  async appendRowByHeader(sheetName: string, data: Record<string, string>): Promise<number> {
    const headers = await this.getHeaders(sheetName);
    if (headers.length === 0) throw new Error(`Cabeçalhos não encontrados em "${sheetName}".`);
    const values = [this.mapObjectToRow(data, headers)];
    const range = `${sheetName}!A1`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&includeValuesInResponse=true`;
    const r = await this.request<{ updates?: { updatedRange?: string } }>(url, "POST", { values });
    const a1 = r.updates?.updatedRange || "";             // ex.: Metadados!A5:B5
    const m = a1.match(/![A-Z]+(\d+):/);
    const rowNumberA1 = m ? parseInt(m[1], 10) : NaN;
    return Number.isFinite(rowNumberA1) ? (rowNumberA1 - 1) : -1; // 0-based
  }

  async updateRowByIndex(sheetName: string, rowIndex: number, data: Record<string, string>): Promise<void> {
    if (!Number.isInteger(rowIndex) || rowIndex < 1) throw new Error("rowIndex inválido (>=1).");
    const headers = await this.getHeaders(sheetName);
    if (headers.length === 0) throw new Error(`Cabeçalho da aba "${sheetName}" não encontrado.`);
    const original = await this.getRowArrayByIndex(sheetName, rowIndex);
    if (!original) throw new Error(`Linha ${rowIndex} inexistente em "${sheetName}".`);
    const outRow: string[] = headers.map((h, i) => {
      const has = Object.prototype.hasOwnProperty.call(data, h);
      return has ? String(data[h] ?? "") : String(original[i] ?? "");
    });
    const lastColA1 = this.colToA1(headers.length - 1);
    const a1 = `${sheetName}!A${rowIndex + 1}:${lastColA1}${rowIndex + 1}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(a1)}?valueInputOption=USER_ENTERED`;
    await this.request(url, "PUT", { range: a1, majorDimension: "ROWS", values: [outRow] });
  }

  async softDeleteRowByIndex(sheetName: string, rowIndex: number): Promise<void> {
    if (!Number.isInteger(rowIndex) || rowIndex < 1) throw new Error("rowIndex inválido (>=1).");
    const headers = await this.getHeaders(sheetName);
    if (headers.length === 0) throw new Error(`Cabeçalho da aba "${sheetName}" não encontrado.`);
    const exists = await this.getRowArrayByIndex(sheetName, rowIndex);
    if (!exists) throw new Error(`Linha ${rowIndex} não existe (ou vazia).`);
    const dashRow = headers.map(() => "-");
    const lastColA1 = this.colToA1(headers.length - 1);
    const a1 = `${sheetName}!A${rowIndex + 1}:${lastColA1}${rowIndex + 1}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(a1)}?valueInputOption=USER_ENTERED`;
    await this.request(url, "PUT", { range: a1, majorDimension: "ROWS", values: [dashRow] });
  }

  /** =============== Metadados (por ÍNDICE) =============== */

  /** Lê do localStorage o mapa de metadados (index, sheetName, lastMod) */
  getMetaLocal(): MetaLocalMap {
    try {
      const raw = localStorage.getItem(SheetsClient.META_CACHE_KEY);
      return raw ? (JSON.parse(raw) as MetaLocalMap) : {};
    } catch { return {}; }
  }
  private setMetaLocal(map: MetaLocalMap) {
    try { localStorage.setItem(SheetsClient.META_CACHE_KEY, JSON.stringify(map)); } catch { }
  }

  /** Guarda/obtém os índices das colunas (fallback “lento”). */
  private setMetaHeadersIndex(sheetNameIdx: number, lastModIdx: number) {
    try { localStorage.setItem(SheetsClient.META_HEADERS_KEY, JSON.stringify({ sheetNameIdx, lastModIdx })); } catch { }
  }
  private getMetaHeadersIndex(): { sheetNameIdx: number; lastModIdx: number } | null {
    try {
      const raw = localStorage.getItem(SheetsClient.META_HEADERS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  /** Construção INICIAL do meta local: lê a aba Metadados inteira, mapeia por nome e salva {index, sheetName, lastMod}. */
  async buildMetaLocalFromSheet(): Promise<MetaLocalMap> {
    const matrix = await this.getSheetMatrix(SheetsClient.META_TAB);
    if (matrix.length === 0) {
      const empty: MetaLocalMap = {};
      this.setMetaLocal(empty);
      return empty;
    }

    const headers = matrix[0] ?? [];
    const lower = headers.map(h => String(h ?? "").trim().toLowerCase());
    const sheetNameIdx = Math.max(0, lower.findIndex(h => h === "sheetname" || h === "sheet_name" || h === "pagina" || h === "página" || h === "sheetname"));
    const lastModIdx = Math.max(0, lower.findIndex(h => h.startsWith("ultima") || h.startsWith("última") || h === "ultimamodificacao"));

    this.setMetaHeadersIndex(sheetNameIdx, lastModIdx);

    const out: MetaLocalMap = {};
    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i] ?? [];
      const name = String(row[sheetNameIdx] ?? "").trim();
      const last = String(row[lastModIdx] ?? "").trim();
      if (!name) continue;
      out[name] = { index: i, sheetName: name, lastMod: last };
    }
    this.setMetaLocal(out);
    return out;
  }

  /** FAST-PATH: lê só a célula B{rowNumberA1} da aba Metadados. Retorna ISO ou null. */
  async getMetaLastModByIndexFast(rowIndex: number): Promise<string | null> {
    if (!Number.isInteger(rowIndex) || rowIndex < 1) {
      throw new Error("rowIndex inválido para Metadados (use >= 1).");
    }
    const rowA1 = rowIndex + 1;
    const a1 = `${SheetsClient.META_TAB}!${SheetsClient.META_LASTMOD_COL}${rowA1}:${SheetsClient.META_LASTMOD_COL}${rowA1}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(a1)}?majorDimension=ROWS`;
    const r = await this.request<{ values?: string[][] }>(url, "GET");
    return (r.values?.[0]?.[0] ?? "").toString().trim() || null;
  }

  /** Fallback “lento”: lê a linha toda por índice e devolve {sheetName,lastMod}. */
  async getRemoteMetaByIndex(index: number): Promise<{ sheetName: string; lastMod: string } | null> {
    let hdrs = this.getMetaHeadersIndex();
    if (!hdrs) {
      const headers = await this.getHeaders(SheetsClient.META_TAB);
      const lower = headers.map(h => String(h ?? "").trim().toLowerCase());
      const sheetNameIdx = Math.max(0, lower.findIndex(h => h === "sheetname" || h === "sheet_name" || h === "pagina" || h === "página" || h === "sheetname"));
      const lastModIdx = Math.max(0, lower.findIndex(h => h.startsWith("ultima") || h.startsWith("última") || h === "ultimamodificacao"));
      this.setMetaHeadersIndex(sheetNameIdx, lastModIdx);
      hdrs = { sheetNameIdx, lastModIdx };
    }
    const { sheetNameIdx, lastModIdx } = hdrs;
    const row = await this.getRowArrayByIndex(SheetsClient.META_TAB, index);
    if (!row) return null;
    const name = String(row[sheetNameIdx] ?? "").trim();
    const last = String(row[lastModIdx] ?? "").trim();
    return { sheetName: name, lastMod: last };
  }

  /**
   * Atualiza (ou cria) a linha de Metadados para a 'sheetName' e
   * mantém o meta local coerente (index,sheetName,lastMod).
   * Se 'iso' não for passado, usa o ISO atual.
   */
  async upsertMeta(sheetName: string, iso?: string): Promise<MetaLocalEntry> {
    const value = iso || new Date().toISOString();
    let meta = this.getMetaLocal();
    const entry = meta[sheetName];

    const updatePayload: Record<string, string> = {
      SheetName: sheetName,
      UltimaModificacao: value,
    };

    if (entry && entry.index >= 1) {
      await this.updateRowByIndex(SheetsClient.META_TAB, entry.index, updatePayload);
      const next: MetaLocalEntry = { index: entry.index, sheetName, lastMod: value };
      meta[sheetName] = next;
      this.setMetaLocal(meta);
      return next;
    }

    // não existe ainda → append e descobrir o índice criado
    const newIndex = await this.appendRowByHeader(SheetsClient.META_TAB, updatePayload);
    const created: MetaLocalEntry = { index: newIndex, sheetName, lastMod: value };

    // atualiza o mapa local (garantindo consistência com outras entradas)
    meta = this.getMetaLocal();
    meta[sheetName] = created;
    this.setMetaLocal(meta);
    return created;
  }

  /** Leitura da aba como objetos com rowIndex (para Consulta). */
  async getObjectsWithIndex<T extends Record<string, any> = Record<string, any>>(
    sheetName: string
  ): Promise<Array<{ rowIndex: number; rowNumberA1: number; object: T }>> {
    const matrix = await this.getSheetMatrix(sheetName);
    if (matrix.length === 0) return [];
    const headers = await this.getHeaders(sheetName);
    const out: Array<{ rowIndex: number; rowNumberA1: number; object: T }> = [];
    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i] ?? [];
      const normalized = headers.map((_, j) => row[j] ?? "");
      const obj: Record<string, any> = {};
      headers.forEach((h, j) => (obj[h] = normalized[j] ?? ""));
      out.push({ rowIndex: i, rowNumberA1: i + 1, object: obj as T });
    }
    return out;
  }
  /** Lê um ÚNICO registro pelo rowIndex (0 = cabeçalho; use >= 1 para dados).
 *  Retorna { rowIndex, rowNumberA1, object } ou null se a linha não existir.
 */
  async getObjectByIndex<T extends Record<string, string> = Record<string, string>>(
    sheetName: string,
    rowIndex: number
  ): Promise<{ rowIndex: number; rowNumberA1: number; object: T } | null> {
    if (!Number.isInteger(rowIndex) || rowIndex < 1) {
      throw new Error("rowIndex inválido (0 é o cabeçalho; use >= 1).");
    }

    // pega headers para mapear as colunas
    const headers = await this.getHeaders(sheetName);
    if (headers.length === 0) throw new Error(`Cabeçalho da aba "${sheetName}" não encontrado.`);

    // lê só a linha alvo
    const lastColA1 = this.colToA1(headers.length - 1);
    const a1 = `${sheetName}!A${rowIndex + 1}:${lastColA1}${rowIndex + 1}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(a1)}?majorDimension=ROWS`;
    const data = await this.request<{ values?: string[][] }>(url, "GET");

    const row = data.values?.[0] ?? [];
    if (row.length === 0 || row.every(c => !c || c === "")) {
      return null;
    }

    // normaliza para o tamanho do cabeçalho
    const normalized = row.slice(0, headers.length);
    while (normalized.length < headers.length) normalized.push("");

    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = String(normalized[i] ?? ""); });

    return {
      rowIndex,
      rowNumberA1: rowIndex + 1,
      object: obj as T,
    };
  }

}
