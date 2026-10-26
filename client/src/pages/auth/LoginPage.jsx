import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button, Field, Notice, PasswordInput, SectionHeading } from "../../components/ui/index.js";
import { isDemoMode, PATHS, ROLES } from "../../constants.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";

const PORTALS = {
  [ROLES.PATIENT]: { title: "Sign in to Carewell", home: PATHS.discover, label: "patient" },
  [ROLES.DOCTOR]: { title: "Doctor sign in", home: PATHS.doctorDashboard, label: "doctor" },
  [ROLES.ADMIN]: { title: "Administrator sign in", home: PATHS.admin, label: "administrator" },
};

/**
 * Where to send a freshly signed-in user. Unverified patients must confirm their
 * email first; everyone else returns to the page they were heading to.
 */
function afterSignIn(user, state, fallback) {
  if (user.role === ROLES.PATIENT && !user.emailVerified) return { to: PATHS.verifyEmail, state };
  return {
    to: state?.from?.pathname ?? fallback,
    state: state?.resumeBooking ? { resumeBooking: true } : undefined,
  };
}

/**
 * Sign-in for one portal. `portal` only selects the screen: the server decides
 * the account's real role and we verify that it matches before continuing.
 * @param {{portal: 'patient'|'doctor'|'admin'}} props
 */
export default function LoginPage({ portal }) {
  const { user, login, logout } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const config = PORTALS[portal];
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Already signed in (including right after a successful sign-in): continue to where the
  // visitor was heading, or the portal home.
  if (user?.role === portal) {
    const next = afterSignIn(user, location.state, config.home);
    return <Navigate to={next.to} replace state={next.state} />;
  }

  const submit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const signedIn = await login({
        email: String(form.get("email")).trim(),
        password: String(form.get("password")),
        portal,
      });
      if (signedIn.role !== portal) {
        await logout();
        setError(`This account is not authorised for the ${config.label} portal.`);
        return;
      }
      notify(isDemoMode ? "Demo sign-in only; identity is not verified." : "Signed in.");
      const next = afterSignIn(signedIn, location.state, config.home);
      navigate(next.to, { replace: true, state: next.state });
    } catch (err) {
      setError(err.message || "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  };

  const prompt =
    location.state?.notice ??
    (location.state?.resumeBooking
      ? "Sign in or create an account to book your appointment. We’ll bring you straight back to this doctor."
      : location.state?.reason === "protected"
        ? "Please sign in to continue."
        : "");

  return (
    <div className="signin-page">
      <SectionHeading
        eyebrow={portal === ROLES.PATIENT ? "WELCOME BACK" : "CAREWELL PORTAL"}
        title={config.title}
        description={
          isDemoMode
            ? "Demo mode: sign-in is simulated and does not authenticate identity."
            : "Your account is authenticated by the Carewell service."
        }
      />
      <form className="admin-form surface signin-form" onSubmit={submit}>
        <Notice>{prompt}</Notice>
        <div className="form-grid">
          <Field label="Email">
            <input name="email" type="email" required autoComplete="username" />
          </Field>
          <Field label="Password">
            <PasswordInput
              name="password"
              required
              autoComplete="current-password"
              reveal={portal !== ROLES.ADMIN}
            />
          </Field>
        </div>
        <Notice error>{error}</Notice>
        <p className="form-link">
          <Link className="text-link" to={PATHS.forgotPassword}>
            Forgot your password?
          </Link>
        </p>
        <div className="form-actions">
          {portal === ROLES.PATIENT && (
            <>
              <Link className="button button-outline" to={PATHS.doctorLogin}>
                I’m a doctor
              </Link>
              <Link className="button button-outline" to={PATHS.signup} state={location.state}>
                Create an account
              </Link>
            </>
          )}
          {portal === ROLES.DOCTOR && (
            <Link className="button button-outline" to={PATHS.doctorRegister}>
              Join as a doctor
            </Link>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"} <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </div>
  );
}
