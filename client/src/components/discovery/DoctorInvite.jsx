import { ArrowRight, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { PATHS } from "../../constants.js";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { assetUrl } from "../../utils/assets.js";

const POINTS = [
  "Create your profile and add the clinics where you see patients.",
  "Upload your BMDC registration certificate; the administration verifies it.",
  "Set your own times and accept the requests that suit you.",
];

/** An invitation to doctors, with the photo supplied by the project owner. */
export default function DoctorInvite() {
  const { t } = useLanguage();
  return (
    <section className="home-section doctor-invite surface">
      <img
        src={assetUrl("images/hero/hero-doctor.jpg")}
        alt={t("A doctor in a white coat with his arms crossed")}
        loading="lazy"
      />
      <div>
        <span className="eyebrow">{t("ARE YOU A DOCTOR?")}</span>
        <h2>
          {t("Reach patients who are")} <em>{t("looking for you.")}</em>
        </h2>
        <p>{t("Carewell gives you a professional profile and a calm way to manage appointment requests.")}</p>
        <ul>
          {POINTS.map((point) => (
            <li key={point}>
              <Check size={16} /> {t(point)}
            </li>
          ))}
        </ul>
        <div className="hero-actions">
          <Link className="button button-primary" to={PATHS.doctorRegister}>
            {t("Join as a doctor")} <ArrowRight size={16} />
          </Link>
          <Link className="button button-outline" to={PATHS.doctorLogin}>
            {t("Doctor sign in")}
          </Link>
        </div>
      </div>
    </section>
  );
}
