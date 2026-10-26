import { Check, Circle, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PASSWORD_RULES } from "../../utils/password.js";

/**
 * A password box with a "show password" eye. Put it inside <Field>. With `rules`, a checklist
 * under it ticks off what a new password still needs (use it wherever a password is CHOSEN, not
 * where it is entered). `reveal={false}` leaves the eye out (the administrator sign-in).
 */
export default function PasswordInput({ reveal = true, rules = false, onInput, ...props }) {
  const [shown, setShown] = useState(false);
  const [value, setValue] = useState("");
  const input = useRef(null);
  useEffect(() => {
    const form = input.current?.form;
    const clear = () => setValue("");
    form?.addEventListener("reset", clear);
    return () => form?.removeEventListener("reset", clear);
  }, []);

  return (
    <>
      <span className="password-input">
        <input
          {...props}
          ref={input}
          type={reveal && shown ? "text" : "password"}
          onInput={(event) => {
            setValue(event.currentTarget.value);
            onInput?.(event);
          }}
        />
        {reveal && (
          <button
            type="button"
            className="password-toggle"
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            title={shown ? "Hide password" : "Show password"}
            onClick={() => setShown((current) => !current)}
          >
            {shown ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </span>
      {rules && (
        <ul className="password-rules" aria-label="What the password needs">
          {PASSWORD_RULES.map((rule) => {
            const met = rule.test(value);
            return (
              <li key={rule.key} className={met ? "is-met" : ""}>
                {met ? <Check size={12} /> : <Circle size={12} />} {rule.label}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
