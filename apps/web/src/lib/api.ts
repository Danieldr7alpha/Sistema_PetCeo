import { cacheResponse, invalidateCachedResponses, readCachedResponse } from "./offline";

const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "/api" : "http://127.0.0.1:3333");
export type ConnectionFailure = "api" | "database";

function reportNetworkFailure() {
  window.dispatchEvent(new Event("ceo-pet-network-failure"));
}

export type Session = {
  token: string;
  user: { id: string; name: string; email: string; role: "ADMIN" | "EMPLOYEE"; permissions?: string[] };
  company: { id: string; name: string };
};

export class ApiError extends Error {
  code?: string;
  status: number;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = localStorage.getItem("ceo-pet-session");
  let parsedSession: Session | null = null;
  try {
    parsedSession = session ? JSON.parse(session) as Session : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    localStorage.removeItem("ceo-pet-session");
  }
  const token = parsedSession?.token ?? null;
  const method = String(options.method ?? "GET").toUpperCase();
  const requiresLiveState = path === "/cash/current";
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    reportNetworkFailure();
    if (method === "GET" && parsedSession && !requiresLiveState) {
      const cached = await readCachedResponse<T>(parsedSession.company.id, parsedSession.user.id, path);
      if (cached !== undefined) {
        window.dispatchEvent(new CustomEvent("ceo-pet-offline-cache", { detail: true }));
        return cached;
      }
    }
    if (method !== "GET") {
      if (path.startsWith("/cash") || path.includes("/checkout")) {
        throw new ApiError("Para concluir pagamentos ou movimentações de caixa, é necessário conectar o sistema à internet.", 0, "OFFLINE_CRITICAL_OPERATION");
      }
      if (path.startsWith("/appointments") && typeof options.body === "string" && options.body.includes('"FINISHED"')) {
        throw new ApiError("Para finalizar um atendimento e consumir o pacote, é necessário conectar o sistema à internet.", 0, "OFFLINE_CRITICAL_OPERATION");
      }
      throw new ApiError("Esta alteração ainda exige conexão. Nenhum dado foi perdido ou enviado parcialmente.", 0, "OFFLINE_WRITE_NOT_ENABLED");
    }
    throw new ApiError(`Não foi possível conectar à API em ${API_URL}.`, 0, "API_UNREACHABLE");
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Erro inesperado" }));
    if (import.meta.env.DEV) {
      const requestBody = typeof options.body === "string"
        ? (() => { try { return JSON.parse(options.body); } catch { return "[unavailable]"; } })()
        : "[unavailable]";
      const sanitize = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(sanitize);
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          /password|token|secret|authorization|key/i.test(key) ? "[REDACTED]" : sanitize(item)
        ]));
      };
      console.error("API_REQUEST_ERROR", {
        code: error.code ?? response.status,
        message: error.message,
        path,
        details: error.details,
        payload: sanitize(requestBody)
      });
    }
    const isPublicAuthRequest = path === "/auth/login" || path === "/auth/register" || path === "/auth/forgot-password" || path === "/auth/reset-password";
    if (response.status === 401 && !isPublicAuthRequest) {
      localStorage.removeItem("ceo-pet-session");
      window.dispatchEvent(new Event("ceo-pet-auth-expired"));
      throw new Error("Sua sessão expirou. Entre novamente.");
    }
    if (error.code === "DATABASE_UNREACHABLE" || error.code === "DATABASE_SCHEMA_OUTDATED") {
      reportNetworkFailure();
    }
    throw new ApiError(error.message ?? "Erro inesperado", response.status, error.code, error.details);
  }

  if (response.status === 204) return undefined as T;
  const result = await response.json() as T;
  if (method === "GET" && parsedSession && !requiresLiveState) {
    void cacheResponse(parsedSession.company.id, parsedSession.user.id, path, result);
  } else if (parsedSession) {
    void invalidateCachedResponses(parsedSession.company.id, parsedSession.user.id);
  }
  return result;
}

export async function checkConnection(attempts = 2): Promise<ConnectionFailure | null> {
  if (!navigator.onLine) return "api";
  let lastFailure: ConnectionFailure = "api";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${API_URL}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(4000)
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.database === "connected") return null;
      lastFailure = "database";
    } catch {
      lastFailure = "api";
    }
  }
  return lastFailure;
}

export function currency(value: number | string) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function dateBR(value: string) {
  return new Date(value).toLocaleDateString("pt-BR");
}
