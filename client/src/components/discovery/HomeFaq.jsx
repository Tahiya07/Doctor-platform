import { ChevronDown } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext.jsx";

const QUESTIONS = [
  [
    "Is asking for a time the same as booking?",
    "No. You ask for a time and the doctor accepts or declines. You are told by notification and email, and only an accepted request is an appointment.",
  ],
  [
    "How do I know a doctor is genuine?",
    "Every doctor’s BMDC registration certificate is checked by the administration before the profile is published. Verified doctors carry a “Verified” label.",
  ],
  [
    "How do I pay?",
    "The website does not take payments. The consultation fee is shown on each doctor’s card, and you pay at the clinic.",
  ],
  [
    "Can I ask for a time for someone else?",
    "Yes. When you ask for a time you can say it is for a family member, and give their name and phone number.",
  ],
  [
    "Can I cancel?",
    "Yes. Open Appointments and cancel a waiting or accepted request. The doctor is told straight away.",
  ],
  [
    "Is there a Bengali version?",
    "Yes. Press the বাংলা button at the top of any page and the whole website, and the emails we send you, will be in Bengali.",
  ],
];

export default function HomeFaq() {
  const { t } = useLanguage();
  return (
    <section className="home-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t("QUESTIONS")}</span>
          <h2>
            {t("Good to")} <em>{t("know.")}</em>
          </h2>
        </div>
      </div>
      <div className="faq-list">
        {QUESTIONS.map(([question, answer]) => (
          <details className="faq-item surface" key={question}>
            <summary>
              {t(question)} <ChevronDown size={18} />
            </summary>
            <p>{t(answer)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
