// Minimal OpenSearch HTTP client (fetch, no extra dependency): only the
// calls the indexer needs. Tests replace it with a fake.

export interface SearchEngineResponse {
  body: unknown;
  status: number;
}

export interface SearchEngineHttp {
  request(method: "DELETE" | "GET" | "HEAD" | "POST" | "PUT", path: string, body?: unknown): Promise<SearchEngineResponse>;
  bulk(lines: unknown[]): Promise<SearchEngineResponse>;
}

export class FetchSearchEngineHttp implements SearchEngineHttp {
  constructor(
    private readonly url: string,
    private readonly authorization?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  request(method: "DELETE" | "GET" | "HEAD" | "POST" | "PUT", path: string, body?: unknown) {
    return this.send(method, path, body === undefined ? undefined : JSON.stringify(body), "application/json");
  }

  bulk(lines: unknown[]) {
    return this.send("POST", "/_bulk", `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "application/x-ndjson");
  }

  private async send(method: string, path: string, body: string | undefined, contentType: string): Promise<SearchEngineResponse> {
    const response = await this.fetchImpl(`${this.url}${path}`, {
      ...(body === undefined ? {} : { body }),
      headers: { "Content-Type": contentType, ...(this.authorization ? { Authorization: this.authorization } : {}) },
      method,
      signal: AbortSignal.timeout(30_000),
    });
    const text = method === "HEAD" ? "" : await response.text();
    return { body: text ? JSON.parse(text) as unknown : null, status: response.status };
  }
}
