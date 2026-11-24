"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

import { emailSuggestion, formatPhone, normalizeEmail, PHONE_INCOMPLETE_MESSAGE } from "../_lib/input-masks";
import styles from "./masked-fields.module.css";

type BaseInput = Omit<InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "name" | "onChange" | "pattern" | "type" | "value">;

/**
 * A phone field (board «Маски полей и предпросмотр фото»): shows «+7 (924) 474-26-05» while the form receives the
 * same «+79244742605» as before through a hidden field named `name` — the server and the form handlers are unchanged.
 * Controlled with `value`/`onChange` (the number in that format), or uncontrolled with `defaultValue`.
 */
export function PhoneField({ defaultValue, name, onChange, required, value, ...rest }: BaseInput & {
  defaultValue?: string | null;
  name: string;
  onChange?: (e164: string) => void;
  value?: string;
}) {
  const [display, setDisplay] = useState(() => formatPhone(value ?? defaultValue ?? "").display);
  const [e164, setE164] = useState<string | null>(() => formatPhone(value ?? defaultValue ?? "").e164);
  const input = useRef<HTMLInputElement>(null);

  // A value set from outside (a saved draft, another form) is shown in the mask.
  useEffect(() => {
    if (value === undefined) return;
    const next = formatPhone(value);
    if (next.e164 !== e164 || (!value && display)) { setDisplay(next.display); setE164(next.e164); }
    // Only an outside change of `value` re-reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // An unfinished number cannot be sent: the browser says so at the field.
  useEffect(() => {
    const unfinished = display.replace(/\D/gu, "").length > 1 && !e164;
    input.current?.setCustomValidity(unfinished ? PHONE_INCOMPLETE_MESSAGE : "");
  }, [display, e164]);

  return (
    <>
      <input
        {...rest}
        autoComplete={rest.autoComplete ?? "tel"}
        inputMode="tel"
        onChange={(event) => {
          let raw = event.target.value;
          // Backspace over «)», « » or «-» takes the digit before it, not only the sign the mask puts back.
          if (raw.length < display.length && raw.replace(/\D/gu, "") === display.replace(/\D/gu, "")) {
            raw = raw.replace(/\d(?=\D*$)/u, "");
          }
          const next = formatPhone(raw);
          setDisplay(next.display);
          setE164(next.e164);
          onChange?.(next.e164 ?? "");
        }}
        placeholder={rest.placeholder ?? "+7 (___) ___-__-__"}
        ref={input}
        required={required}
        type="tel"
        value={display}
      />
      <input name={name} type="hidden" value={e164 ?? ""} />
    </>
  );
}

/**
 * An e-mail field: no spaces, the domain in small letters, and a hint for the usual slips («gmial.com» →
 * «gmail.com») with a button that fixes it. Controlled with `value`/`onChange`, or uncontrolled.
 */
export function EmailField({ defaultValue, name, onChange, value, ...rest }: BaseInput & {
  defaultValue?: string | null;
  name: string;
  onChange?: (email: string) => void;
  value?: string;
}) {
  const [own, setOwn] = useState(defaultValue ?? "");
  const current = value ?? own;
  const suggestion = emailSuggestion(current);
  const set = (next: string) => {
    if (value === undefined) setOwn(next);
    onChange?.(next);
  };
  return (
    <>
      <input
        {...rest}
        autoCapitalize="none"
        autoComplete={rest.autoComplete ?? "email"}
        inputMode="email"
        name={name}
        onChange={(event) => set(normalizeEmail(event.target.value))}
        spellCheck={false}
        type="email"
        value={current}
      />
      {suggestion ? (
        <span className={styles.suggestion} role="status">
          Возможно, <b>{suggestion}</b>?
          <button onClick={() => set(suggestion)} type="button">Исправить</button>
        </span>
      ) : null}
    </>
  );
}
