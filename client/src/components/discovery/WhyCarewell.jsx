import { BadgeCheck, Languages, LockKeyhole, Mail, MessageCircle, Receipt } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext.jsx";

const REASONS = [
  {
    icon: BadgeCheck,
    title: "Doctors checked against BMDC",
    text: "Before a profile is published, the administration compares the doctor’s registration certificate with the BMDC register.",
  },
  {
    icon: Receipt,
    title: "Fees shown up front",
    text: "The consultation fee and the clinic are on every doctor’s card, so there are no surprises at the door.",
  },
  {
    icon: MessageCircle,
    title: "Talk to your doctor",
    text: "When a doctor accepts your request, you can message them and share what they should know before you arrive.",
  },
  {
    icon: Languages,
    title: "In Bengali and English",
    text: "One button switches the whole website, including the emails we send you, to the language you are comfortable in.",
  },
  {
    icon: Mail,
    title: "Kept in the loop",
    text: "You get a notification and an email when your request is received, accepted or changed. The reason for your visit is never put in an email.",
  },
  {
    icon: LockKeyhole,
    title: "Your account is protected",
    text: "Strong passwords are required, and administrator accounts lock for a while after four wrong tries.",
  },
];

export default function WhyCarewell() {
  const { t } = useLanguage();
  return (
    <section className="home-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t("WHY CAREWELL")}</span>
          <h2>
            {t("Made to be")} <em>{t("easy to trust.")}</em>
          </h2>
          <p>{t("Health is personal. These are the things we do to earn your confidence.")}</p>
        </div>
      </div>
      <div className="why-grid">
        {REASONS.map(({ icon: Icon, title, text }) => (
          <article className="why-card surface" key={title}>
            <span className="step-icon">
              <Icon size={20} />
            </span>
            <h3>{t(title)}</h3>
            <p>{t(text)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
