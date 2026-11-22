"use client";

import Link from "next/link";
import { useActionState, useState, useTransition, type FormEvent } from "react";
import { ArrowLeft, CircleAlert, Eye, EyeOff, Loader2, Lock, LockKeyhole, Mail, Smartphone } from "lucide-react";
import { signInLandlord, type LandlordLoginState } from "@/app/admin/login/actions";
import { CodeInput } from "@/components/shared/code-input";
import { ResendCountdown } from "@/components/shared/resend-countdown";
import { Logo } from "@/components/shared/logo";
import styles from "@/components/shared/sign-in/sign-in.module.css";

function Message({ state }: { state: LandlordLoginState }) {
  if (state.error) {
    return (
      <p role="alert" className={styles.error}>
        <CircleAlert width={16} height={16} style={{ flex: "none", marginTop: 2 }} aria-hidden="true" />
        <span>{state.error}</span>
      </p>
    );
  }
  if (state.notice) return <p role="status" className={styles.notice}>{state.notice}</p>;
  return null;
}

function Submit({ pending, children, ...props }: React.ComponentProps<"button"> & { pending: boolean }) {
  return (
    <button type="submit" disabled={pending} aria-busy={pending || undefined} className={styles.primary} {...props}>
      {pending ? <Loader2 className={styles.spinner} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function LandlordLoginForm({ next, appName, supportEmail }: { next?: string; appName: string; supportEmail?: string }) {
  const [state, dispatch, actionPending] = useActionState<LandlordLoginState, FormData>(signInLandlord, { step: "password", next });
  const [transitionPending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);
  const pending = actionPending || transitionPending;

  // Submit without React's automatic form reset, so typed values survive an error.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) formData.set(submitter.name, submitter.value);
    startTransition(() => dispatch(formData));
  };

  if (state.step === "code") {
    return (
      <form onSubmit={onSubmit} className={styles.form} key="code" noValidate>
        <input type="hidden" name="next" value={state.next ?? ""} />
        <input type="hidden" name="keepSignedIn" value={state.keepSignedIn ? "true" : "false"} />
        <button type="submit" name="intent" value="restart" formNoValidate className={styles.back}>
          <ArrowLeft width={16} height={16} aria-hidden="true" /> Back
        </button>
        <div className={styles.logoRow}>
        <Logo variant="light" kind="full" height={36} priority />
      </div>
        <div className={styles.headingBlock}>
          <h1 className={styles.heading}>Check your phone</h1>
          <p className={styles.subheading}>
            Enter the 6-digit code we sent to <strong style={{ color: "#171717", whiteSpace: "nowrap" }}>{state.maskedPhone}</strong>
          </p>
        </div>
        <Message state={state} />
        <CodeInput invalid={Boolean(state.error)} label="Sign-in code" boxClassName={styles.codeBox} />
        <Submit pending={pending} name="intent" value="code">Verify and continue</Submit>
        <div className={styles.centerStack}>
          <ResendCountdown
            startedAt={state.codeSentAt ?? 0}
            waitingLabel="Resend in"
            waitingClassName={styles.resendWaiting}
            className={styles.resendButton}
          />
          <button type="submit" name="intent" value="restart" formNoValidate className={styles.textButton}>
            Use a different account
          </button>
        </div>
        <div className={styles.footer}>
          <p className={styles.footnote}>
            <LockKeyhole className={styles.footnoteIcon} aria-hidden="true" />
            The code expires in 5 minutes. Never share it with anyone.
          </p>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className={styles.form} key="password" noValidate>
      <input type="hidden" name="intent" value="password" />
      <input type="hidden" name="next" value={state.next ?? ""} />
      <div className={styles.logoRow}>
        <Logo variant="light" kind="full" height={36} priority />
      </div>
      <div className={styles.headingBlock}>
        <h1 className={styles.heading}>
          Welcome back to
          <br />
          {appName}
        </h1>
        <p className={styles.subheading}>Sign in to manage your buildings and rent.</p>
      </div>
      <Message state={state} />

      <div className={styles.field}>
        <label htmlFor="email" className={styles.label}>Email address</label>
        <div className={styles.inputWrap}>
          <Mail className={styles.inputIcon} aria-hidden="true" />
          <input
            id="email" name="email" type="email" autoComplete="username" required
            defaultValue={state.email} placeholder="you@company.co.ke"
            aria-invalid={state.error ? true : undefined}
            className={styles.input}
          />
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="password" className={styles.label}>Password</label>
        <div className={styles.inputWrap}>
          <Lock className={styles.inputIcon} aria-hidden="true" />
          <input
            id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required
            placeholder="Your password"
            aria-invalid={state.error ? true : undefined}
            className={`${styles.input} ${styles.inputWithToggle}`}
          />
          <button
            type="button"
            className={styles.eye}
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff width={18} height={18} aria-hidden="true" /> : <Eye width={18} height={18} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div className={styles.row}>
        <label className={styles.checkboxLabel}>
          <input type="checkbox" name="keepSignedIn" defaultChecked={state.keepSignedIn} className={styles.checkbox} />
          Keep me signed in
        </label>
        {supportEmail ? (
          <a className={styles.link} href={`mailto:${supportEmail}?subject=${encodeURIComponent(`Password reset for ${appName}`)}`}>
            Forgot password?
          </a>
        ) : null}
      </div>

      <Submit pending={pending}>Sign in</Submit>

      <div className={styles.divider} aria-hidden="true">or</div>

      <Link href="/tenants/login" className={styles.secondary}>
        <Smartphone width={18} height={18} aria-hidden="true" />
        Tenant login
      </Link>

      <div className={styles.footer}>
        <p className={styles.footnote}>
          <LockKeyhole className={styles.footnoteIcon} aria-hidden="true" />
          If two-factor is on, we text a 6-digit code after your password.
        </p>
        {supportEmail ? (
          <p style={{ margin: 0 }}>
            Need help? <a className={styles.support} href={`mailto:${supportEmail}`}>Contact support</a>
          </p>
        ) : null}
      </div>
    </form>
  );
}
