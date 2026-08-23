import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyTheme, loadTheme } from "./theme.ts";
import "./app.css";

applyTheme(loadTheme());

createRoot(document.getElementById("root")!).render(<App />);
