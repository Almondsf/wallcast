import { useEffect, useRef, useState } from "react";
import type { Project } from "../types";
import * as api from "../api";

interface Props {
  onSelect: (id: number) => void;
  onLogout: () => void;
}

export default function ProjectsPage({ onSelect, onLogout }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const project = await api.uploadProject(file);
      setProjects((prev) => [project, ...prev]);
      onSelect(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="projects-page">
      <header className="page-header">
        <h1>WallCast</h1>
        <button type="button" className="link-btn" onClick={onLogout}>
          Log out
        </button>
      </header>

      <div className="upload-row">
        <label className="upload-btn">
          {uploading ? "Uploading…" : "Upload a room photo"}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFile}
            disabled={uploading}
            hidden
          />
        </label>
      </div>
      {error && <p className="status error">{error}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : projects.length === 0 ? (
        <p className="hint">No projects yet. Upload a room photo to get started.</p>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <button type="button" key={p.id} className="project-card" onClick={() => onSelect(p.id)}>
              <img src={api.resolveUrl(p.original_image_url)} alt="" />
              <span>{p.mask_url ? "Mask ready" : "No mask yet"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
