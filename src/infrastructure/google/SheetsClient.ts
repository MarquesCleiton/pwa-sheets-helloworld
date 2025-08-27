// src/infrastructure/google/SheetsClient.ts
import { GoogleAuthManager } from "../auth/GoogleAuthManager";

export class SheetsClient {
  private readonly sheetId: string;

  constructor(sheetId: string = "19B2aMGrajvhPJfOvYXt059-fECytaN38iFsP8GInD_g") {
    this.sheetId = sheetId;
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

    // Cabeçalhos para definir a ordem/quantidade de colunas
    const headers = await this.getHeaders(sheetName);
    if (headers.length === 0) throw new Error(`Cabeçalho da aba "${sheetName}" não encontrado.`);

    // Lê só a linha alvo (sem varrer toda a planilha)
    const row = await this.getRowArrayByIndex(sheetName, rowIndex);
    if (!row) return null; // inexistente ou completamente vazia

    // Normaliza o tamanho da linha ao tamanho dos cabeçalhos
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

  // =========================================================
  // ============== Autenticação (inalterado) ================
  // =========================================================

  private async getAccessToken(): Promise<string> {
    // Mantém o mesmo padrão de validação e reautenticação de token (projeto atual)
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

  /**
   * Helper HTTP para chamadas à API do Google Sheets.
   * - Mantém o padrão da sua versão anterior.
   * - Lida graciosamente com respostas sem JSON (ex.: 204).
   */
  private async request<T = any>(url: string, method: string = "GET", body?: any): Promise<T> {
    const headers = await this.getHeadersInit();

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let errorPayload: any = {};
      try {
        errorPayload = await res.json();
      } catch {
        // pode não haver corpo em erros específicos
      }
      console.error("Erro na requisição ao Google Sheets:", errorPayload);
      throw new Error(errorPayload?.error?.message || `Erro ao acessar o Google Sheets (HTTP ${res.status}).`);
    }

    // Pode ser 204 No Content ou content-type não JSON
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

  /**
   * Retorna todas as células preenchidas da aba como uma matriz (inclui a linha de cabeçalho).
   * Ex.: [["ID","Nome","Email"],["1","Ana","ana@..."], ...]
   */
  async getSheetMatrix(sheetName: string): Promise<string[][]> {
    // Em Values.get, o "range" pode ser apenas o nome da aba para pegar o intervalo usado
    const range = encodeURIComponent(sheetName);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${range}?majorDimension=ROWS`;
    const res = await this.request<{ values?: string[][] }>(url, "GET");
    return res.values ?? [];
  }

  /**
   * Cabeçalhos normalizados (primeira linha).
   * Usa a primeira linha da matriz para evitar o limite "A1:Z1".
   */
  async getHeaders(sheetName: string): Promise<string[]> {
    const matrix = await this.getSheetMatrix(sheetName);
    if (matrix.length === 0) return [];
    const headersRaw = matrix[0] ?? [];
    return headersRaw.map((h, i) => {
      const k = String(h ?? "").trim();
      return k.length ? k : `col_${i + 1}`;
    });
  }

  /**
   * Lê todas as linhas como objetos (mapeando cabeçalhos) — compatível com seu cadastro.
   * Mantida para retrocompatibilidade.
   */
  async getSheetObjects<T extends Record<string, any> = Record<string, any>>(sheetName: string): Promise<T[]> {
    const matrix = await this.getSheetMatrix(sheetName);
    if (matrix.length === 0) return [];

    const headers = (matrix[0] ?? []).map((h, i) => {
      const k = String(h ?? "").trim();
      return k.length ? k : `col_${i + 1}`;
    });

    const rows = matrix.slice(1);
    const out: T[] = [];

    for (const row of rows) {
      // Garante mesmo comprimento da linha que o cabeçalho
      const normalized = row.slice(0, headers.length);
      while (normalized.length < headers.length) normalized.push("");

      const obj: Record<string, any> = {};
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]] = normalized[i] ?? "";
      }

      // Se a linha estiver totalmente vazia, ignora (opcional)
      const isEmpty = Object.values(obj).every(v => String(v ?? "").trim().length === 0);
      if (!isEmpty) out.push(obj as T);
    }

    return out;
  }

  /**
   * Lê a aba como objetos e DEVOLVE o índice da linha (0-based) + rowNumberA1 (1-based).
   * Não filtra linhas “apagadas” (só com "-"); quem chama decide.
   */
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

  // =========================================================
  // ================== Criação (APPEND) =====================
  // =========================================================

  private mapObjectToRow(obj: Record<string, string>, headers: string[]): string[] {
    return headers.map(header => obj[header] ?? "");
  }

  /**
   * Anexa uma linha ao final da aba, usando os cabeçalhos como referência.
   * Mantida para o seu fluxo de cadastro (genérico).
   */
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

  /**
   * Lê rapidamente apenas a linha alvo (A{row}:{lastCol}{row}).
   * Retorna null se a linha estiver completamente vazia.
   */
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

  /**
   * Atualiza a linha indicada por rowIndex (overlay de 'data' sobre a linha original).
   * - 'rowIndex' é OBRIGATÓRIO e deve ser >= 1 (0 é o cabeçalho).
   * - As chaves de 'data' devem bater com os cabeçalhos (exatamente o texto do cabeçalho).
   * - Colunas não presentes em 'data' são preservadas.
   * - Envia na ORDEM DO CABEÇALHO, independente da ordem das chaves em 'data'.
   */
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

    // Lê apenas a linha alvo para validar existência e preservar colunas não enviadas
    const original = await this.getRowArrayByIndex(sheetName, rowIndex);
    if (!original) {
      throw new Error(`Linha ${rowIndex} não existe (ou está totalmente vazia).`);
    }

    // Monta a linha final respeitando a ordem do cabeçalho
    const outRow: string[] = headers.map((h, i) => {
      const has = Object.prototype.hasOwnProperty.call(data, h);
      return has ? String(data[h] ?? "") : String(original[i] ?? "");
    });

    const lastColA1 = this.colToA1(headers.length - 1);
    const a1 = `${sheetName}!A${rowIndex + 1}:${lastColA1}${rowIndex + 1}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(a1)}?valueInputOption=USER_ENTERED`;

    await this.request(url, "PUT", { range: a1, majorDimension: "ROWS", values: [outRow] });
  }

  /**
   * "Exclusão" lógica: preenche TODAS as células da linha com "-" (mantém integridade/contagem).
   * - 'rowIndex' é OBRIGATÓRIO e deve ser >= 1 (0 é cabeçalho).
   */
  async softDeleteRowByIndex(sheetName: string, rowIndex: number): Promise<void> {
    if (!Number.isInteger(rowIndex) || rowIndex < 1) {
      throw new Error("rowIndex inválido (0 é cabeçalho; use >= 1).");
    }

    const headers = await this.getHeaders(sheetName);
    if (headers.length === 0) throw new Error(`Cabeçalho da aba "${sheetName}" não encontrado.`);

    // valida existência da linha de forma pontual
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
}
