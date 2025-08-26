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
}
