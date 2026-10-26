import { Activity, ChevronRight, Menu, Moon, Sun } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { PATHS } from "../../constants.js";
import { useTheme } from "../../context/ThemeContext.jsx";
import { IconButton } from "../ui/index.js";
import AccountMenu from "./AccountMenu.jsx";
import LanguageSwitch from "./LanguageSwitch.jsx";
import { routeTitle } from "./navigation.js";
import NotificationBell from "./NotificationBell.jsx";

export default function Topbar({ onOpenMenu }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { pathname } = useLocation();
  const nextTheme = resolvedTheme === "dark" ? "light" : "dark";

  return (
    <header className="topbar nav-shell">
      <div className="nav-identity">
        <div className="topbar-brand glass-card-light">
          <Link className="topbar-brand-home" to={PATHS.discover}>
            <span className="brand-mark">
              <Activity size={17} />
            </span>
            <span className="topbar-brand-copy">
              <strong>Carewell</strong>
              <small>HEALTH PORTAL</small>
            </span>
          </Link>
          <span className="brand-crumb">
            <ChevronRight size={13} />
            <strong>{routeTitle(pathname)}</strong>
          </span>
        </div>
      </div>
      <div className="command-pill glass-card-light">
        <LanguageSwitch />
        <IconButton label={`Switch to ${nextTheme} theme`} onClick={toggleTheme}>
          {resolvedTheme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
        </IconButton>
        <NotificationBell />
        <AccountMenu />
      </div>
      <button className="mobile-menu glass-pill" type="button" onClick={onOpenMenu} aria-label="Open menu">
        <Menu size={19} />
      </button>
    </header>
  );
}
