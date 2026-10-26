import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import DoctorProfileFields, { validateDoctorProfile } from "../../components/doctors/DoctorProfileFields.jsx";
import { Button, Field, Notice, SectionHeading, PasswordInput } from "../../components/ui/index.js";
import { isDemoMode, PATHS } from "../../constants.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useCatalog } from "../../context/CatalogContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { readDoctorProfileForm } from "../../utils/forms.js";
import { isValidEmail, isValidPhone, PHONE_PATTERN } from "../../utils/validation.js";
import { passwordProblem } from "../../utils/password.js";

export default function DoctorRegisterPage() {
  const { registerDoctor } = useAuth();
  const { specialties, facilities } = useCatalog();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const account = {
      email: String(data.get("email")).trim(),
      password: String(data.get("password")),
      phone: String(data.get("phone")).trim(),
    };
    const profile = readDoctorProfileForm(form);

    const found = validateDoctorProfile(profile);
    if (!isValidEmail(account.email)) found.email = "Enter a valid email address.";
    if (!isValidPhone(account.phone)) found.phone = "Enter a valid phone number.";
    if (passwordProblem(account.password)) found.password = passwordProblem(account.password);
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    setFormError("");
    try {
      await registerDoctor({ ...account, ...profile });
      notify("Account created. Check your email for a 6-digit code.");
      navigate(PATHS.doctorApplication, { replace: true });
    } catch (error) {
      setFormError(error.message || "Registration could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionHeading
        eyebrow="JOIN CAREWELL"
        title="Apply as a doctor"
        description={
          isDemoMode
            ? "Demo mode: registration is simulated and creates no real account."
            : "Create your account. Next you’ll confirm your email, upload your BMDC registration certificate and submit your application. Patients see your profile only after the administration checks your BMDC registration."
        }
      />
      <form className="admin-form surface" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Email" error={errors.email}>
            <input name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Password" error={errors.password}>
            <PasswordInput name="password" required autoComplete="new-password" rules />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <input name="phone" type="tel" required pattern={PHONE_PATTERN} autoComplete="tel" />
          </Field>
          <DoctorProfileFields
            specialties={specialties}
            facilities={facilities}
            errors={errors}
            glassSpecialtySelect
          />
        </div>
        <Notice error>{formError}</Notice>
        <div className="form-actions">
          <Link className="button button-outline" to={PATHS.doctorLogin}>
            I already have an account
          </Link>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating account…" : "Create account and continue"} <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </>
  );
}
