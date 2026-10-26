import {
  Activity,
  ArrowUpRight,
  Baby,
  Bone,
  Brain,
  Droplet,
  Ear,
  Eye,
  Flower2,
  Heart,
  MessageCircleHeart,
  Smile,
  Soup,
  Sparkles,
  Stethoscope,
  Wind,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { doctorsSearchPath, PATHS } from "../../constants.js";
import { useCatalog } from "../../context/CatalogContext.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";

const ICONS = {
  cardiology: Heart,
  neurology: Brain,
  dermatology: Sparkles,
  pediatrics: Baby,
  gynecology: Flower2,
  dentistry: Smile,
  orthopedics: Bone,
  ophthalmology: Eye,
  ent: Ear,
  psychiatry: MessageCircleHeart,
  gastroenterology: Soup,
  endocrinology: Activity,
  urology: Droplet,
  pulmonology: Wind,
};

const SHOWN = 8;

/** "Browse by specialty": the specialties that have the most doctors, each opening the directory. */
export default function SpecialtyGrid({ doctors = [] }) {
  const navigate = useNavigate();
  const { specialties } = useCatalog();
  const { t } = useLanguage();
  const counts = new Map();
  for (const doctor of doctors) counts.set(doctor.specialtyId, (counts.get(doctor.specialtyId) ?? 0) + 1);
  const shown = [...specialties]
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name))
    .slice(0, SHOWN);
  if (!shown.length) return null;

  return (
    <section className="home-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t("BROWSE BY SPECIALTY")}</span>
          <h2>
            {t("Care for every")} <em>{t("need.")}</em>
          </h2>
          <p>{t("Start with what you are feeling. Pick a specialty and see the doctors who treat it.")}</p>
        </div>
        <Link className="text-link" to={PATHS.doctors}>
          {t("All specialties")} <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="specialty-grid">
        {shown.map((specialty) => {
          const Icon = ICONS[specialty.id] ?? Stethoscope;
          const count = counts.get(specialty.id) ?? 0;
          return (
            <button
              key={specialty.id}
              type="button"
              className="specialty-card surface"
              onClick={() => navigate(doctorsSearchPath({ specialty: specialty.id }))}
            >
              <span className="specialty-icon">
                <Icon size={20} />
              </span>
              <strong>{t(specialty.name)}</strong>
              <small>{t(specialty.description)}</small>
              <span className="specialty-count">{t(`${count} ${count === 1 ? "doctor" : "doctors"}`)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
