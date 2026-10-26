// Bengali text is set in Noto Sans Bengali (bundled with the website, so it works offline and without Google).
import "@fontsource/noto-sans-bengali/bengali-400.css";
import "@fontsource/noto-sans-bengali/bengali-500.css";
import "@fontsource/noto-sans-bengali/bengali-600.css";
import "@fontsource/noto-sans-bengali/bengali-700.css";
import "@fontsource/noto-sans-bengali/latin-400.css";
import "@fontsource/noto-sans-bengali/latin-500.css";
import "@fontsource/noto-sans-bengali/latin-600.css";
import "@fontsource/noto-sans-bengali/latin-700.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/pages.css";
import "./styles/home.css";
import "./styles/responsive.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App, { AppProviders } from "./App.jsx";

// HashRouter keeps deep links working on static hosts (GitHub Pages) without
// server rewrites. Switch to BrowserRouter once the app is served with SPA fallback.
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <HashRouter>
      <AppProviders>
        <App />
      </AppProviders>
    </HashRouter>
  </StrictMode>,
);
