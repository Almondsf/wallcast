import type { MaskMode, MaskPoint, MaskResult, PaintColor, Project, Render } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
const TOKEN_KEY = "wallcast_token";

let token: string | null = localStorage.getItem(TOKEN_KEY);

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getToken() {
  return token;
}

export function resolveUrl(path: string) {
  return `${API_BASE}${path}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Request failed with status ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function register(email: string, password: string) {
  return request<{ access_token: string }>("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export async function login(email: string, password: string) {
  const body = new URLSearchParams({ username: email, password });
  return request<{ access_token: string }>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

export async function listProjects() {
  return request<Project[]>("/projects/");
}

export async function getProject(id: number) {
  return request<Project>(`/projects/${id}`);
}

export async function uploadProject(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<Project>("/projects/", { method: "POST", body: form });
}

export async function createMask(
  projectId: number,
  params: { mode: MaskMode; points: MaskPoint[]; tolerance?: number; straighten?: number },
) {
  return request<MaskResult>(`/projects/${projectId}/mask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function updateMask(projectId: number, maskPngDataUrl: string, straighten?: number) {
  return request<MaskResult>(`/projects/${projectId}/mask`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mask_png: maskPngDataUrl, straighten }),
  });
}

export async function listPaintColors() {
  return request<PaintColor[]>("/paint-colors/");
}

export async function createRender(
  projectId: number,
  params: { paint_color_top_id: number; paint_color_bottom_id: number | null; split_position: number | null },
) {
  return request<Render>(`/projects/${projectId}/renders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}
