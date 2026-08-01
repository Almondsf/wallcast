import { useState } from "react";
import * as api from "./api";
import AuthPage from "./pages/AuthPage";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import "./App.css";

type View = { name: "projects" } | { name: "detail"; projectId: number };

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(api.getToken()));
  const [view, setView] = useState<View>({ name: "projects" });

  function handleAuthenticated(token: string) {
    api.setToken(token);
    setAuthed(true);
    setView({ name: "projects" });
  }

  function handleLogout() {
    api.setToken(null);
    setAuthed(false);
    setView({ name: "projects" });
  }

  if (!authed) {
    return <AuthPage onAuthenticated={handleAuthenticated} />;
  }

  if (view.name === "detail") {
    return <ProjectDetailPage projectId={view.projectId} onBack={() => setView({ name: "projects" })} />;
  }

  return <ProjectsPage onSelect={(id) => setView({ name: "detail", projectId: id })} onLogout={handleLogout} />;
}
