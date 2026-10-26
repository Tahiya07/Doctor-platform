import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Button,
  EmptyState,
  Field,
  Notice,
  SectionHeading,
  PasswordInput,
} from "../../components/ui/index.js";
import { PATHS } from "../../constants.js";
import { authService } from "../../services/index.js";
import { passwordProblem } from "../../utils/password.js";

/**
 * Step 2 of a password reset: the page the emailed link opens (`#/reset-password?token=…`).
 * The token is single-use and validated by the server, never by this page.
 */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [linkProblem, setLinkProblem] = useState(false);
  const [busy, setBusy] = useState(false);

  const requestNewLink = (
    <Link className="button button-primary" to={PATHS.forgotPassword}>
      Request a new link
    </Link>
  );

  if (!token)
    return (
      <EmptyState
        title="This link is incomplete"
        description="Open the reset link from your email again, or request a new one."
        action={requestNewLink}
      />
    );

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
      await authService.resetPassword({ token, password });
      navigate(PATHS.login, {
        replace: true,
        state: { notice: "Your password was updated. Sign in with your new password." },
      });
    } catch (error) {
      // 410 / 404 mean the link is used up or expired; anything else is a retryable problem.
      if (error.status === 410 || error.status === 404) setLinkProblem(true);
      else setFormError(error.message || "Your password could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  if (linkProblem)
    return (
      <EmptyState
        title="This link has expired"
        description="Reset links work once and expire quickly. Request a new one to continue."
        action={requestNewLink}
      />
    );

  return (
    <>
      <SectionHeading
        eyebrow="ALMOST DONE"
        title="Choose a new password"
        description="Pick something you don’t use anywhere else. You’ll sign in with it straight away."
      />
      <form className="admin-form surface" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="New password" error={errors.password}>
            <PasswordInput name="password" required autoComplete="new-password" rules />
          </Field>
          <Field label="Confirm new password" error={errors.confirm}>
            <PasswordInput name="confirm" required autoComplete="new-password" />
          </Field>
        </div>
        <Notice error>{formError}</Notice>
        <div className="form-actions">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Update password"} <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </>
  );
}
