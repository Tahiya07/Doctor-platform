import { assetUrl } from "../../utils/assets.js";
import { useLanguage } from "../../context/LanguageContext.jsx";

/** Photos in /public/images (credits: docs/IMAGE_CREDITS.md). */
export const HERO_IMAGE = "images/hero/hero-doctor.jpg";

/** Home-page hero. `doctor` is the profile highlighted in the floating card. */
export default function HeroSection() {
  const { t } = useLanguage();
  return (
    <section className="hero">
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
      </div>
      <div className="hero-visual">
        <div className="hero-image-wrap">
          <img
            className="hero-image"
            src={assetUrl(HERO_IMAGE)}
            alt="A doctor in a white coat with his arms crossed"
          />
          <div className="hero-image-overlay" />
          <span className="image-stamp">CW—01</span>
        </div>
        <div className="hero-caption">
          <span>
            <i /> {t("A LITTLE MORE HUMAN, BY DESIGN")}
          </span>
          <span>01 / 03</span>
        </div>
      </div>
    </section>
  );
}
