import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { PATHS } from "../../constants.js";
import { useCatalog } from "../../context/CatalogContext.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { assetUrl } from "../../utils/assets.js";

/** Photos in /public/images (credits: docs/IMAGE_CREDITS.md). */
export const HERO_IMAGE = "images/hero/hero-clinic.jpg";

const showHowItWorks = () =>
  document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth", block: "start" });

/**
 * Home-page banner: a full-width photo with the headline on it and, along the bottom, what the
 * site holds right now. `doctorCount` is the number of published doctors (undefined while loading).
 */
export default function HeroSection({ doctorCount }) {
  const { t } = useLanguage();
  const { facilities, specialties } = useCatalog();
  const stats = [
    [doctorCount, "verified doctors"],
    [facilities.length, "hospitals & clinics"],
    [specialties.length, "specialties"],
  ];

  return (
    <section className="home-hero">
      <img
        className="home-hero-image"
        src={assetUrl(HERO_IMAGE)}
        alt={t("A doctor checking a patient’s blood pressure in a clinic")}
        fetchPriority="high"
      />
      <div className="home-hero-shade" />
      <div className="hero-copy">
        <span className="eyebrow">
          <i /> {t("CARE THAT MEETS YOU HERE")}
        </span>
        <h1>
          {t("Good care starts")}
          <br />
          {t("with")}{" "}
          <em>
            {t("the right")}
            <br />
            {t("connection.")}
          </em>
        </h1>
        <p>
          {t(
            "Meet trusted doctors who listen, understand, and help you feel your best — wherever you are in your health journey.",
          )}
        </p>
        <div className="hero-actions">
          <Link className="button button-primary" to={PATHS.doctors}>
            {t("Find a doctor")} <ArrowRight size={16} />
          </Link>
          <button type="button" className="button button-hero-ghost" onClick={showHowItWorks}>
            {t("How it works")}
          </button>
        </div>
      </div>
      <ul className="home-hero-stats">
        {stats.map(([value, label]) => (
          <li key={label}>
            <strong>{value ?? "–"}</strong>
            <span>{t(label)}</span>
          </li>
        ))}
        <li>
          <strong translate="no">বাংলা · EN</strong>
          <span>{t("in your language")}</span>
        </li>
      </ul>
    </section>
  );
}
