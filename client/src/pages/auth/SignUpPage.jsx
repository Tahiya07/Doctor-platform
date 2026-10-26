import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button, Field, Notice, SectionHeading, PasswordInput } from "../../components/ui/index.js";
import { isDemoMode, PATHS, ROLES } from "../../constants.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { isValidEmail, isValidPhone, PHONE_PATTERN } from "../../utils/validation.js";
import { passwordProblem } from "../../utils/password.js";

/** Patient registration. The account must verify its email before it can book. */
export default function SignUpPage() {
  const { user, registerPatient } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user?.role === ROLES.PATIENT)
    return (
      <Navigate to={user.emailVerified ? PATHS.discover : PATHS.verifyEmail} replace state={location.state} />
    );

  const submit = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      name: String(data.get("name")).trim(),
      email: String(data.get("email")).trim(),
      phone: String(data.get("phone")).trim(),
      password: String(data.get("password")),
    };
    const found = {};
    if (input.name.length < 2) found.name = "Enter your full name.";
    if (!isValidEmail(input.email)) found.email = "Enter a valid email address.";
    if (!isValidPhone(input.phone)) found.phone = "Enter a valid phone number.";
    if (passwordProblem(input.password)) found.password = passwordProblem(input.password);
    if (input.password !== String(data.get("confirm"))) found.confirm = "The passwords don’t match.";
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    setFormError("");
    try {
      await registerPatient(input);
      // Verification comes first; the original destination travels along.
      navigate(PATHS.verifyEmail, { replace: true, state: location.state });
    } catch (error) {
      setFormError(error.message || "Your account could not be created.");
      if (error.details) setErrors(error.details);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionHeading
        eyebrow="JOIN CAREWELL"
        title="Create your account"
        description={
          isDemoMode
            ? "Demo mode: no real account is created and no email is sent."
            : "One account to book visits, follow your appointments and message your doctor."
        }
      />
      <form className="admin-form surface" onSubmit={submit} noValidate>
        <Notice>
          {location.state?.resumeBooking
            ? "Create an account to book your appointment. We’ll bring you straight back to this doctor."
            : ""}
        </Notice>
        <div className="form-grid">
          <Field label="Full name" error={errors.name}>
            <input name="name" required autoComplete="name" />
          </Field>
          <Field label="Email" error={errors.email}>
            <input name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Phone number" error={errors.phone}>
            <input
              name="phone"
              type="tel"
              required
              pattern={PHONE_PATTERN}
              autoComplete="tel"
              placeholder="+880 1XXX XXXXXX"
            />
          </Field>
          <Field label="Password" error={errors.password}>
            <PasswordInput name="password" required autoComplete="new-password" rules />
          </Field>
          <Field label="Confirm password" error={errors.confirm}>
            <PasswordInput name="confirm" required autoComplete="new-password" />
          </Field>
        </div>
        <Notice error>{formError}</Notice>
        <div className="form-actions">
          <Link className="button button-outline" to={PATHS.login} state={location.state}>
            I already have an account
          </Link>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create account"} <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </>
  );
}
