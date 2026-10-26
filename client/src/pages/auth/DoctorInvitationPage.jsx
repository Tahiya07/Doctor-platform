import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Button,
  EmptyState,
  Field,
  Notice,
  PageLoader,
  SectionHeading,
  PasswordInput,
} from "../../components/ui/index.js";
import { PATHS } from "../../constants.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { useResource } from "../../hooks/useResource.js";
import { authService } from "../../services/index.js";
import { formatDay } from "../../utils/dates.js";
import { passwordProblem } from "../../utils/password.js";

/**
 * The page the invitation email opens (`#/doctor/invitation?token=…`): an administrator added this
 * doctor, and they choose a password here. The token is single-use, expires after 48 hours and is
 * checked by the server, never by this page.
 */
export default function DoctorInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { acceptInvitation } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const invitation = useResource(() => authService.getInvitation(token), [token], {
    enabled: Boolean(token),
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const expired = (
    <EmptyState
      title="This invitation link has expired"
      description="Invitation links work once and expire after 48 hours. Ask the Carewell administration to send you a new one."
    />
  );
  if (!token) return expired;
  if (invitation.error)
    return invitation.error.status === 410 ? expired : <Notice error>{invitation.error.message}</Notice>;
  if (!invitation.data) return <PageLoader label="Checking your invitation…" />;

  const submit = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));
    const found = {};
    if (passwordProblem(password)) found.password = passwordProblem(password);
    if (password !== String(data.get("confirm"))) found.confirm = "The passwords don’t match.";
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    setFormError("");
    try {
      await acceptInvitation({ token, password });
      notify("Welcome to Carewell. Next, complete your application.");
      navigate(PATHS.doctorApplication, { replace: true });
    } catch (error) {
      if (error.status === 410) invitation.reload();
      else setFormError(error.message || "Your password could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin-page">
      <SectionHeading
        eyebrow="YOU’RE INVITED"
        title={`Welcome, ${invitation.data.name}`}
        description={`The Carewell administration added you as a doctor (${invitation.data.email}). Choose a password to continue. This link expires on ${formatDay(invitation.data.expiresAt)}.`}
      />
      <form className="admin-form surface signin-form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Password" error={errors.password}>
            <PasswordInput name="password" required autoComplete="new-password" rules />
          </Field>
          <Field label="Confirm password" error={errors.confirm}>
            <PasswordInput name="confirm" required autoComplete="new-password" />
          </Field>
        </div>
        <Notice>
          Next you’ll complete your profile and upload your BMDC registration certificate. The administration
          checks it with the BMDC register before your profile is published.
        </Notice>
        <Notice error>{formError}</Notice>
        <div className="form-actions">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Set password and continue"} <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </div>
  );
}
