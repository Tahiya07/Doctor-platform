import { CalendarCheck, MessageCircle, Search } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext.jsx";

const STEPS = [
  {
    icon: Search,
    title: "Find the right doctor",
    text: "Search by specialty, name or area. Compare experience, consultation fees and clinic locations side by side.",
  },
  {
    icon: CalendarCheck,
    title: "Ask for a time",
    text: "Choose an open time at the doctor’s clinic. Your request goes straight to the doctor, and nothing is booked until they accept it.",
  },
  {
    icon: MessageCircle,
    title: "Talk, then visit",
    text: "Once the doctor accepts, you can message them here and visit at the agreed time. We also email you at every step.",
  },
];

/** Three plain steps from searching to the visit (the hero's "How it works" button scrolls here). */
export default function HowItWorks() {
  const { t } = useLanguage();
  return (
    <section className="home-section" id="how-it-works">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t("HOW IT WORKS")}</span>
          <h2>
            {t("Three steps to")} <em>{t("your visit.")}</em>
          </h2>
          <p>{t("No phone queues and no guessing. You always know where your request stands.")}</p>
        </div>
      </div>
      <ol className="steps-grid">
        {STEPS.map(({ icon: Icon, title, text }, index) => (
          <li className="step-card surface" key={title}>
            <span className="step-number">0{index + 1}</span>
            <span className="step-icon">
              <Icon size={22} />
            </span>
            <h3>{t(title)}</h3>
            <p>{t(text)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
