import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { startBengaliTranslation } from "../i18n/domTranslator.js";
import { translate } from "../i18n/translate.js";

const KEY = "carewell:language";

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    try {
      return window.localStorage.getItem(KEY) === "bn" ? "bn" : "en";
    } catch {
      return "en";
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, language);
    } catch {
      // The selected language remains active for this session when storage is unavailable.
    }
    // The whole page follows the choice: the document language (screen readers, hyphenation, the Bengali font)
    // and, for Bengali, every piece of text on the page, including what appears later.
    document.documentElement.lang = language;
    document.documentElement.dataset.language = language;
    return language === "bn" ? startBengaliTranslation(document.body) : undefined;
  }, [language]);

  const value = useMemo(
    () => ({ language, setLanguage, t: (text) => (language === "bn" ? (translate(text) ?? text) : text) }),
    [language],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside <LanguageProvider>.");
  return context;
}
