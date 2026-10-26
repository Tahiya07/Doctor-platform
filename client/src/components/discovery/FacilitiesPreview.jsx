import { ArrowUpRight, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { PATHS } from "../../constants.js";
import { useCatalog } from "../../context/CatalogContext.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { FacilityImage, Pill } from "../ui/index.js";

/** A few hospitals and clinics, linking to the full list. */
export default function FacilitiesPreview() {
  const { facilities } = useCatalog();
  const { t } = useLanguage();
  const shown = facilities.slice(0, 4);
  if (!shown.length) return null;

  return (
    <section className="home-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t("CARE AROUND YOUR CORNER")}</span>
          <h2>
            {t("Hospitals & clinics")} <em>{t("near you.")}</em>
          </h2>
          <p>{t("See where each doctor sees patients, with the address and opening hours.")}</p>
        </div>
        <Link className="text-link" to={PATHS.facilities}>
          {t("See all places")} <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="facility-strip">
        {shown.map((facility) => (
          <Link className="facility-tile surface" to={PATHS.facilities} key={facility.id}>
            <FacilityImage src={facility.image} alt={facility.name} />
            <div>
              <Pill>{t(facility.type === "hospital" ? "Hospital" : "Clinic")}</Pill>
              <strong>{facility.name}</strong>
              <small>
                <MapPin size={13} /> {facility.area}, {facility.city}
              </small>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
