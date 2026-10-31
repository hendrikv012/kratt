import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "./hooks/theme.jsx";
import StudyPreview from "./views/studyhome/StudyPreview";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles/globals.css";
import "./styles/kanban.css";
import "./styles/windows.css";

// Load KaTeX for math rendering
import katex from "katex";
import "katex/dist/katex.min.css";

// Make KaTeX globally available for the math extension
globalThis.katex = katex;

// Make React globally available for extensions
globalThis.React = React;

// Same page structure the study app had inside Lokus, so its layout CSS still applies
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <div className="app-root">
        <div className="app-titlebar" data-tauri-drag-region></div>
        <div className="app-content">
          <StudyPreview />
        </div>
      </div>
    </ThemeProvider>
  </React.StrictMode>
);
