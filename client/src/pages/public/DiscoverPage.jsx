import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import CareBanner from "../../components/discovery/CareBanner.jsx";
import DiscoverSearch from "../../components/discovery/DiscoverSearch.jsx";
import DoctorInvite from "../../components/discovery/DoctorInvite.jsx";
import FacilitiesPreview from "../../components/discovery/FacilitiesPreview.jsx";
import HeroSection from "../../components/discovery/HeroSection.jsx";
import HomeFaq from "../../components/discovery/HomeFaq.jsx";
import HowItWorks from "../../components/discovery/HowItWorks.jsx";
import SpecialtyGrid from "../../components/discovery/SpecialtyGrid.jsx";
import WhyCarewell from "../../components/discovery/WhyCarewell.jsx";
import DoctorGrid from "../../components/doctors/DoctorGrid.jsx";
import { ScrollReveal } from "../../components/ui/index.js";
import { PATHS } from "../../constants.js";
import { useBooking } from "../../context/BookingContext.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { useResource } from "../../hooks/useResource.js";
import { doctorService } from "../../services/index.js";

const FEATURED = 6;

export default function DiscoverPage() {
  const { openBooking } = useBooking();
  const { t } = useLanguage();
  const { data: doctors, loading, error, reload } = useResource(() => doctorService.list(), []);
  const featured = doctors?.slice(0, FEATURED);

  return (
    <>
      <ScrollReveal>
        <HeroSection doctorCount={doctors?.length} />
      </ScrollReveal>
      <ScrollReveal>
        <DiscoverSearch />
      </ScrollReveal>
      <ScrollReveal>
        <SpecialtyGrid doctors={doctors} />
      </ScrollReveal>
      <ScrollReveal>
        <section className="featured-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{t("A GOOD PLACE TO BEGIN")}</span>
              <h2>
                {t("Meet our")} <em>{t("doctors.")}</em>
              </h2>
              <p>{t("Explore doctors and review their profiles to find the care that fits your needs.")}</p>
            </div>
            <Link className="text-link" to={PATHS.doctors}>
              {t("Explore all doctors")} <ArrowUpRight size={15} />
            </Link>
          </div>
          <DoctorGrid
            doctors={featured}
            loading={loading}
            error={error}
            onRetry={reload}
            onBook={openBooking}
            emptyAction={
              <Link className="button button-primary" to={PATHS.doctors}>
                {t("Browse all doctors")}
              </Link>
            }
          />
          <div className="doctor-bottom">
            <span>
              <i /> {t("Platform verified professionals")}
            </span>
            <Link className="text-link" to={PATHS.doctors}>
              {t("See all specialists")} <ArrowRight size={15} />
            </Link>
          </div>
        </section>
      </ScrollReveal>
      <ScrollReveal>
        <HowItWorks />
      </ScrollReveal>
      <ScrollReveal>
        <FacilitiesPreview />
      </ScrollReveal>
      <ScrollReveal>
        <WhyCarewell />
      </ScrollReveal>
      <ScrollReveal>
        <DoctorInvite />
      </ScrollReveal>
      <ScrollReveal>
        <HomeFaq />
      </ScrollReveal>
      <ScrollReveal>
        <CareBanner />
      </ScrollReveal>
    </>
  );
}
