import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyTheme, loadTheme } from "./theme.ts";
import "./app.css";
import "katex/dist/katex.min.css";
import "@fortune-sheet/react/dist/index.css";

applyTheme(loadTheme());

createRoot(document.getElementById("root")!).render(<App />);
