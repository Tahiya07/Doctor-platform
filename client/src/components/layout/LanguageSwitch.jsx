import { Languages } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext.jsx";

/** The language button in the top bar: one tap switches the whole website between English and Bengali. */
export default function LanguageSwitch() {
  const { language, setLanguage } = useLanguage();
  const toBengali = language !== "bn";
  const label = toBengali ? "Switch to Bangla" : "Switch to English";
  return (
    <button
      type="button"
      className="language-switch"
      lang={toBengali ? "bn" : "en"}
      aria-label={label}
      title={label}
      onClick={() => setLanguage(toBengali ? "bn" : "en")}
    >
      <Languages size={16} aria-hidden="true" />
      <span className="language-full">{toBengali ? "বাংলা" : "English"}</span>
      <span className="language-short" aria-hidden="true">
        {toBengali ? "বাং" : "EN"}
      </span>
    </button>
  );
}
