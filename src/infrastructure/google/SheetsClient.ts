import { GoogleAuthManager } from "../auth/GoogleAuthManager";

/** ===== Tipos de Metadados (cache local) ===== */
export type MetaLocalEntry = { index: number; lastMod: string };
export type MetaLocalMap = Record<string, MetaLocalEntry>;

export class SheetsClient {
  private readonly sheetId: string;

  /** Nome fixo da aba de metadados */
  static readonly META_TAB = "Metadados";

  constructor(sheetId: string = "19B2aMGrajvhPJfOvYXt059-fECytaN38iFsP8GInD_g") {
    this.sheetId = sheetId;
  }

  // =========================================================
  // ============== Autenticação / HTTP ======================
  // =========================================================

  private async getAccessToken(): Promise<string> {
    await GoogleAuthManager.authenticate();
    const token = GoogleAuthManager.getAccessToken();
    if (!token) throw new Error("Token de acesso inválido ou ausente (Sheets).");
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

  /** Helper HTTP (Sheets API) */
  private async request<T = any>(url: string, method: string = "GET", body?: any): Promise<T> {
    const headers = await this.getHeadersInit();

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    console.log(res)

    if (!res.ok) {
      let errorPayload: any = {};
      try { errorPayload = await res.json(); } catch { }
      console.error("Erro na requisição ao Google Sheets:", errorPayload);
      throw new Error(errorPayload?.error?.message || `Erro ao acessar o Google Sheets (HTTP ${res.status}).`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      try {
        const text = await res.text();
        return (text ? (JSON.parse(text) as T) : (undefined as unknown as T));
      } catch {
        return undefined as unknown as T;
      }
    }
    return (await res.json()) as T;
  }

  // =========================================================
  // ===================== Leitura (READ) ====================
  // =========================================================

  /** Retorna a matriz (linhas x colunas), incluindo cabeçalho. */
  async getSheetMatrix(sheetName: string): Promise<string[][]> {
    const range = encodeURIComponent(sheetName);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${range}?majorDimension=ROWS`;
    const res = await this.request<{ values?: string[][] }>(url, "GET");
    return res.values ?? [];
  }

  /** Cabeçalhos normalizados (primeira linha). */
  async getHeaders(sheetName: string): Promise<string[]> {
    const matrix = await this.getSheetMatrix(sheetName);
    if (matrix.length === 0) return [];
    const headersRaw = matrix[0] ?? [];
    return headersRaw.map((h, i) => {
      const k = String(h ?? "").trim();
      return k.length ? k : `col_${i + 1}`;
    });
  }

  /** Lê a aba como objetos e DEVOLVE o índice da linha (0-based) + rowNumberA1 (1-based). */
  async getObjectsWithIndex<T extends Record<string, any> = Record<string, any>>(
    sheetName: string
  ): Promise<Array<{ rowIndex: number; rowNumberA1: number; object: T }>> {
    const matrix = await this.getSheetMatrix(sheetName);
    if (matrix.length === 0) return [];

    const headers = await this.getHeaders(sheetName);
    const out: Array<{ rowIndex: number; rowNumberA1: number; object: T }> = [];

    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i] ?? [];
      const normalized = row.slice(0, headers.length);
      while (normalized.length < headers.length) normalized.push("");

      const obj: Record<string, any> = {};
      headers.forEach((h, j) => (obj[h] = normalized[j] ?? ""));

      out.push({ rowIndex: i, rowNumberA1: i + 1, object: obj as T });
    }

    return out;
  }

  /** Lê um ÚNICO registro pelo rowIndex (>= 1). */
  async getObjectByIndex<T extends Record<string, string> = Record<string, string>>(
    sheetName: string,
    rowIndex: number
  ): Promise<{ rowIndex: number; rowNumberA1: number; object: T } | null> {
    if (!Number.isInteger(rowIndex) || rowIndex < 1) {
      throw new Error("rowIndex inválido (0 é o cabeçalho; use >= 1).");
    }
    const headers = await this.getHeaders(sheetName);
    if (headers.length === 0) throw new Error(`Cabeçalho da aba "${sheetName}" não encontrado.`);

    const lastColA1 = this.colToA1(headers.length - 1);
    const a1 = `${sheetName}!A${rowIndex + 1}:${lastColA1}${rowIndex + 1}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(a1)}?majorDimension=ROWS`;
    const data = await this.request<{ values?: string[][] }>(url, "GET");

    const row = data.values?.[0] ?? [];
    const allEmpty = row.length === 0 || row.every(c => c === "" || c == null);
    if (allEmpty) return null;

    const normalized = row.slice(0, headers.length);
    while (normalized.length < headers.length) normalized.push("");

    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = String(normalized[i] ?? ""); });

    return { rowIndex, rowNumberA1: rowIndex + 1, object: obj as T };
  }

  // =========================================================
  // ================== Criação (APPEND) =====================
  // =========================================================

  private mapObjectToRow(obj: Record<string, string>, headers: string[]): string[] {
    return headers.map(header => obj[header] ?? "");
  }

  /** Anexa uma linha ao final da aba, usando os cabeçalhos como referência. */
  async appendRowByHeader(sheetName: string, data: Record<string, string>): Promise<void> {
    const headers = await this.getHeaders(sheetName);
    if (headers.length === 0) throw new Error("Cabeçalhos não encontrados na planilha.");

    const values = [this.mapObjectToRow(data, headers)];
    const range = `${sheetName}!A1`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW`;
    await this.request(url, "POST", { values });
  }

  // =========================================================
  // ======= Atualização por índice & Soft Delete ============
  // =========================================================

  /** Converte índice de coluna (0-based) para rótulo A1 (A, B, ..., Z, AA, AB, ...). */
  private colToA1(n: number): string {
    let s = "", x = n;
    while (x >= 0) {
      s = String.fromCharCode((x % 26) + 65) + s;
      x = Math.floor(x / 26) - 1;
    }
    return s;
  }

  /** Lê rapidamente apenas a linha alvo (A{row}:{lastCol}{row}). */
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

  /** Atualiza a linha indicada por rowIndex (overlay de 'data' sobre a linha original). */
  async updateRowByIndex(
    sheetName: string,
    rowIndex: number,
    data: Record<string, string>
  ): Promise<void> {
    if (!Number.isInteger(rowIndex) || rowIndex < 1) {
      throw new Error("rowIndex inválido (0 é cabeçalho; use >= 1).");
    }

    const headers = await this.getHeaders(sheetName);
    if (headers.length === 0) throw new Error(`Cabeçalho da aba "${sheetName}" não encontrado.`);

    const original = await this.getRowArrayByIndex(sheetName, rowIndex);
    if (!original) {
      throw new Error(`Linha ${rowIndex} não existe (ou está totalmente vazia).`);
    }

    const outRow: string[] = headers.map((h, i) => {
      const has = Object.prototype.hasOwnProperty.call(data, h);
      return has ? String(data[h] ?? "") : String(original[i] ?? "");
    });

    const lastColA1 = this.colToA1(headers.length - 1);
    const a1 = `${sheetName}!A${rowIndex + 1}:${lastColA1}${rowIndex + 1}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(a1)}?valueInputOption=USER_ENTERED`;

    await this.request(url, "PUT", { range: a1, majorDimension: "ROWS", values: [outRow] });
  }

  /** "Exclusão" lógica: preenche TODAS as células da linha com "-" (mantém integridade). */
  async softDeleteRowByIndex(sheetName: string, rowIndex: number): Promise<void> {
    if (!Number.isInteger(rowIndex) || rowIndex < 1) {
      throw new Error("rowIndex inválido (0 é cabeçalho; use >= 1).");
    }

    const headers = await this.getHeaders(sheetName);
    if (headers.length === 0) throw new Error(`Cabeçalho da aba "${sheetName}" não encontrado.`);

    // valida existência
    const exists = await this.getRowArrayByIndex(sheetName, rowIndex);
    if (!exists) {
      throw new Error(`Linha ${rowIndex} não existe (ou está totalmente vazia).`);
    }

    const dashRow = headers.map(() => "-");

    const lastColA1 = this.colToA1(headers.length - 1);
    const a1 = `${sheetName}!A${rowIndex + 1}:${lastColA1}${rowIndex + 1}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(a1)}?valueInputOption=USER_ENTERED`;

    await this.request(url, "PUT", { range: a1, majorDimension: "ROWS", values: [dashRow] });
  }

  // =========================================================
  // ===================== Metadados ==========================
  // =========================================================

  /** Chave do cache local de metadados (por planilha). */
  private metaCacheKey(): string {
    return `sheets:${this.sheetId}:meta`;
  }

  /** Lê o cache local (ou {} se não houver). */
  getMetaLocal(): MetaLocalMap {
    try {
      const raw = localStorage.getItem(this.metaCacheKey());
      return raw ? (JSON.parse(raw) as MetaLocalMap) : {};
    } catch {
      return {};
    }
  }

  /** Salva o mapa completo de metadados localmente. */
  private setMetaLocal(map: MetaLocalMap) {
    localStorage.setItem(this.metaCacheKey(), JSON.stringify(map));
  }

  /** Atualiza/insere 1 entrada no cache local. */
  private upsertMetaLocalEntry(sheetName: string, entry: MetaLocalEntry) {
    const map = this.getMetaLocal();
    map[sheetName] = entry;
    this.setMetaLocal(map);
  }

  /** Carrega TODA a aba Metadados e persiste no cache local. (Uso: primeira sincronização) */
  async buildMetaLocalFromSheet(): Promise<MetaLocalMap> {
    const rows = await this.getObjectsWithIndex<Record<string, string>>(SheetsClient.META_TAB);
    const out: MetaLocalMap = {};
    for (const r of rows) {
      const name = String(r.object?.["SheetName"] || "").trim();
      if (!name) continue;
      const last = String(r.object?.["UltimaModificacao"] || "").trim();
      out[name] = { index: r.rowIndex, lastMod: last };
    }
    this.setMetaLocal(out);
    return out;
  }

  /**
   * Fast-path: busca APENAS a célula `Metadados!B{linha}` correspondente ao índice da linha
   * (linha de dados = rowIndex, onde 0=cabeçalho; então A2=>rowIndex=1, B2 é a célula alvo).
   */
  async getMetaLastModByIndexFast(rowIndex: number): Promise<string | null> {
    if (!Number.isInteger(rowIndex) || rowIndex < 1) {
      throw new Error("rowIndex inválido para Metadados (>= 1).");
    }
    const rowNumberA1 = rowIndex + 1; // 1-based
    const range = `${SheetsClient.META_TAB}!B${rowNumberA1}:B${rowNumberA1}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
    const data = await this.request<{ values?: string[][] }>(url, "GET");
    const val = data.values?.[0]?.[0] ?? "";
    const s = String(val ?? "").trim();
    return s.length ? s : null;
    // Obs.: não normalizamos; só retornamos o que está na planilha (esperado: ISO)
  }

  /**
   * Upsert em Metadados para um sheetName específico:
   * - Se já existir (conhecemos o index) → atualiza B{linha} com ISO now (ou 'iso' fornecido).
   * - Se não existir → cria linha no final (A=sheetName, B=ISO now) e retorna index da nova linha.
   * Em ambos os casos, atualiza o cache local.
   */
  // ====== 1) Atualiza SOMENTE no Sheets (não mexe no cache local) ======
  async upsertMetaSheet(sheetName: string, iso?: string): Promise<MetaLocalEntry> {
    const nowIso = iso ?? new Date().toISOString();

    // 1) tenta usar o índice já conhecido (se existir no cache), mas sem atualizar o cache!
    const local = this.getMetaLocal()[sheetName];
    if (local && Number.isInteger(local.index) && local.index >= 1) {
      const rowNumberA1 = local.index + 1;
      const range = `${SheetsClient.META_TAB}!B${rowNumberA1}:B${rowNumberA1}`;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
      await this.request(url, "PUT", { range, majorDimension: "ROWS", values: [[nowIso]] });
      return { index: local.index, lastMod: nowIso };
    }

    // 2) não sabemos o índice → localizar na aba Metadados (sem gravar local)
    const rows = await this.getObjectsWithIndex<Record<string, string>>(SheetsClient.META_TAB);
    let found: { rowIndex: number; rowNumberA1: number } | null = null;
    for (const r of rows) {
      const name = String(r.object?.["SheetName"] || "").trim();
      if (name === sheetName) { found = { rowIndex: r.rowIndex, rowNumberA1: r.rowNumberA1 }; break; }
    }

    if (found) {
      const range = `${SheetsClient.META_TAB}!B${found.rowNumberA1}:B${found.rowNumberA1}`;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
      await this.request(url, "PUT", { range, majorDimension: "ROWS", values: [[nowIso]] });
      return { index: found.rowIndex, lastMod: nowIso };
    }

    // 3) não existe → criar linha nova (A=SheetName, B=ISO)
    const range = `${SheetsClient.META_TAB}!A1`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
    await this.request(url, "POST", { values: [[sheetName, nowIso]] });

    // não atualiza o cache local aqui!
    // retorna um palpite (index desconhecido até reconstruir)
    return { index: -1, lastMod: nowIso };
  }

  // ====== 2) Sincroniza o cache LOCAL com o que está no Sheets ======
  async upsertMetaLocal(sheetName: string): Promise<MetaLocalEntry | null> {
    // se já temos o índice local, usa fast read para comparar
    const map = this.getMetaLocal();
    const entry = map[sheetName];

    if (entry && Number.isInteger(entry.index) && entry.index >= 1) {
      const remoteIso = await this.getMetaLastModByIndexFast(entry.index);
      if (remoteIso && remoteIso !== entry.lastMod) {
        const updated: MetaLocalEntry = { index: entry.index, lastMod: remoteIso };
        // atualiza APENAS o cache local
        const next = { ...map, [sheetName]: updated };
        this.setMetaLocal(next);
        return updated;
      }
      return entry ?? null;
    }

    // não temos índice local → reconstrói metadados a partir do Sheets
    const rebuilt = await this.buildMetaLocalFromSheet();
    return rebuilt[sheetName] ?? null;
  }

}
