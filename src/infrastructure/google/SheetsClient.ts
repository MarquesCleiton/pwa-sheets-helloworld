import { GoogleAuthManager } from "../auth/GoogleAuthManager";

export class SheetsClient {
  private readonly sheetId: string;

  constructor(sheetId: string = "19B2aMGrajvhPJfOvYXt059-fECytaN38iFsP8GInD_g") {
    this.sheetId = sheetId;
  }

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
      "Content-Type": "application/json"
    };
  }

  private async request<T>(url: string, method: string = "GET", body?: any): Promise<T> {
    const headers = await this.getHeadersInit();

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      console.error("Erro na requisição ao Google Sheets:", error);
      throw new Error(error.error?.message || "Erro desconhecido ao acessar o Google Sheets.");
    }

    return res.json();
  }

  async getHeaders(sheetName: string): Promise<string[]> {
    const range = `${sheetName}!A1:Z1`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${range}`;
    const data = await this.request<{ values: string[][] }>(url);
    return data.values?.[0] ?? [];
  }

  private mapObjectToRow(obj: Record<string, string>, headers: string[]): string[] {
    return headers.map(header => obj[header] ?? "");
  }

  async appendRowByHeader(sheetName: string, data: Record<string, string>): Promise<void> {
    const headers = await this.getHeaders(sheetName);
    if (headers.length === 0) throw new Error("Cabeçalhos não encontrados na planilha.");

    const values = [this.mapObjectToRow(data, headers)];
    const range = `${sheetName}!A1`;

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${range}:append?valueInputOption=RAW`;

    await this.request(url, "POST", { values });
  }

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
 * Retorna todas as linhas da aba como objetos, usando a primeira linha como cabeçalho.
 * Ex.: [{ ID:"1", Nome:"Ana", Email:"ana@..." }, ...]
 * - Linhas menores que o cabeçalho são preenchidas com "".
 * - Colunas extras são preservadas como chaves adicionais.
 */
async getSheetObjects<T extends Record<string, any> = Record<string, any>>(sheetName: string): Promise<T[]> {
  const matrix = await this.getSheetMatrix(sheetName);
  if (matrix.length === 0) return [];

  const headersRaw = matrix[0] ?? [];
  // Normaliza cabeçalhos: trim e substitui vazios por "col_X"
  const headers = headersRaw.map((h, i) => {
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
    const isEmpty = Object.values(obj).every(v => (String(v ?? "").trim().length === 0));
    if (!isEmpty) out.push(obj as T);
  }

  return out;
}

}
