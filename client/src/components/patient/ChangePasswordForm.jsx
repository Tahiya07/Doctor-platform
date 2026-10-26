import { KeyRound } from "lucide-react";
import { useState } from "react";
import { authService } from "../../services/index.js";
import { Button, Field, Notice, PasswordInput } from "../ui/index.js";
import { passwordProblem } from "../../utils/password.js";

/** Lets a signed-in patient replace their password. Other devices are signed out by the server. */
export default function ChangePasswordForm() {
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = {
      currentPassword: String(data.get("currentPassword")),
      newPassword: String(data.get("newPassword")),
    };
    const found = {};
    if (!input.currentPassword) found.currentPassword = "Enter your current password.";
    if (passwordProblem(input.newPassword)) found.newPassword = passwordProblem(input.newPassword);
    if (input.newPassword !== String(data.get("confirm"))) found.confirm = "The passwords don’t match.";
    setErrors(found);
    setMessage("");
    if (Object.keys(found).length) return;

    setBusy(true);
    setFormError("");
    try {
      await authService.changePassword(input);
      form.reset();
      setMessage("Your password was changed. Other devices were signed out.");
    } catch (error) {
      setFormError(error.message || "Your password could not be changed.");
      if (error.details) setErrors(error.details);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="admin-form surface" onSubmit={submit} noValidate>
      <h3>Change password</h3>
      <div className="form-grid">
        <Field label="Current password" error={errors.currentPassword}>
          <PasswordInput name="currentPassword" required autoComplete="current-password" />
        </Field>
        <Field label="New password" error={errors.newPassword}>
          <PasswordInput name="newPassword" required autoComplete="new-password" rules />
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          <PasswordInput name="confirm" required autoComplete="new-password" />
        </Field>
      </div>
      <Notice error>{formError}</Notice>
      <Notice>{message}</Notice>
      <div className="form-actions">
        <Button type="submit" disabled={busy}>
          <KeyRound size={15} /> {busy ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
