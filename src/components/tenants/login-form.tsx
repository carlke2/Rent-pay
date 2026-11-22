"use client";

import Link from "next/link";
import { useActionState, useTransition, type FormEvent } from "react";
import { ArrowLeft, CircleAlert, FlaskConical, KeyRound, Loader2, LockKeyhole, Phone, ShieldCheck } from "lucide-react";
import { tenantLogin, type TenantLoginState } from "@/app/tenants/login/actions";
import { CodeInput } from "@/components/shared/code-input";
import { ResendCountdown } from "@/components/shared/resend-countdown";
import styles from "@/components/shared/sign-in/sign-in.module.css";

function Logo({ appName }: { appName: string }) {
  return (
    <div className={styles.logoRow}>
      <span className={styles.logo}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.5 10.5 12 4l8.5 6.5" />
          <path d="M5.5 9v10.5h13V9" />
          <path d="m9 14.2 2.2 2.2 4-4.4" />
        </svg>
        <span className={styles.logoDivider} aria-hidden="true" />
        <span className={styles.logoText}>{appName}</span>
      </span>
    </div>
  );
}

function Message({ state }: { state: TenantLoginState }) {
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

/** Phone → SMS code → (if more than one unit) choose the lease. Uses the existing tenantLogin action. */
export function TenantLoginForm({
  paybill,
  appName,
  supportEmail,
  expiredLink,
  testSignIn = false,
}: {
  paybill: string;
  appName: string;
  supportEmail?: string;
  expiredLink?: boolean;
  /** MPESA_ENV=sandbox: offer the phone + unit code shortcut, clearly labelled "Test sign-in". */
  testSignIn?: boolean;
}) {
  const [state, dispatch, actionPending] = useActionState<TenantLoginState, FormData>(tenantLogin, {
    step: "phone",
    method: "code",
  });
  const [transitionPending, startTransition] = useTransition();
  const pending = actionPending || transitionPending;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) formData.set(submitter.name, submitter.value);
    startTransition(() => dispatch(formData));
  };

  if (state.step === "lease" && state.leases) {
    return (
      <form onSubmit={onSubmit} className={styles.form} key="lease" noValidate>
        <input type="hidden" name="intent" value="choose" />
        <Logo appName={appName} />
        <div className={styles.headingBlock}>
          <h1 className={styles.heading}>Choose your unit</h1>
          <p className={styles.subheading}>You rent more than one unit. Pick the one to open.</p>
        </div>
        <Message state={state} />
        {state.leases.map((lease) => {
          const [unitCode, buildingName] = lease.label.split(" · ");
          return (
            <button key={lease.leaseId} type="submit" name="leaseId" value={lease.leaseId} className={styles.unitOption} disabled={pending}>
              <span className={styles.unitCode}>{unitCode ?? lease.label}</span>
              {buildingName ? <span className={styles.unitBuilding}>{buildingName}</span> : null}
            </button>
          );
        })}
      </form>
    );
  }

  if (state.step === "code" && state.phone) {
    return (
      <form onSubmit={onSubmit} className={styles.form} key="code" noValidate>
        <input type="hidden" name="phone" value={state.phone} />
        <button type="submit" name="intent" value="restart" formNoValidate className={styles.back}>
          <ArrowLeft width={16} height={16} aria-hidden="true" /> Back
        </button>
        <Logo appName={appName} />
        <div className={styles.headingBlock}>
          <h1 className={styles.heading}>Enter your code</h1>
          <p className={styles.subheading}>
            We sent a 6-digit code to <strong style={{ color: "#171717", whiteSpace: "nowrap" }}>{state.maskedPhone}</strong>
          </p>
        </div>
        <Message state={state} />
        <CodeInput invalid={Boolean(state.error)} label="Sign-in code" boxClassName={styles.codeBox} />
        <Submit pending={pending} name="intent" value="verify">Verify and sign in</Submit>
        <div className={styles.centerStack}>
          <ResendCountdown
            startedAt={state.codeSentAt ?? 0}
            waitingLabel="Resend in"
            waitingClassName={styles.resendWaiting}
            className={styles.resendButton}
          />
          <button type="submit" name="intent" value="restart" formNoValidate className={styles.textButton}>
            Wrong number? Change it
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

  if (testSignIn && state.method === "unit") {
    return (
      <form onSubmit={onSubmit} className={styles.form} key="unit" noValidate>
        <input type="hidden" name="intent" value="unit" />
        <Logo appName={appName} />
        <p className={styles.testBadge} role="note">
          <FlaskConical width={16} height={16} aria-hidden="true" /> Test sign-in · sandbox only
        </p>
        <div className={styles.headingBlock}>
          <h1 className={styles.heading}>Test sign-in</h1>
          <p className={styles.subheading}>Phone number and unit code, no SMS. This shortcut doesn&apos;t exist in live mode.</p>
        </div>
        <Message state={state} />
        <div className={styles.field}>
          <label htmlFor="test-phone" className={styles.label}>Phone number</label>
          <div className={styles.inputWrap}>
            <Phone className={styles.inputIcon} aria-hidden="true" />
            <span className={styles.prefix} aria-hidden="true">+254</span>
            <input id="test-phone" name="phone" type="tel" inputMode="tel" required defaultValue={state.typedPhone} placeholder="712 345 678" aria-invalid={state.fieldErrors?.phone ? true : undefined} className={`${styles.input} ${styles.inputWithPrefix}`} />
          </div>
          {state.fieldErrors?.phone ? <p className={styles.fieldError}>{state.fieldErrors.phone}</p> : null}
        </div>
        <div className={styles.field}>
          <label htmlFor="test-unit" className={styles.label}>Unit code</label>
          <div className={styles.inputWrap}>
            <KeyRound className={styles.inputIcon} aria-hidden="true" />
            <input id="test-unit" name="unit" required autoCapitalize="characters" defaultValue={state.typedUnit} placeholder="KIL-A01" aria-invalid={state.fieldErrors?.unit ? true : undefined} className={styles.input} />
          </div>
          {state.fieldErrors?.unit ? <p className={styles.fieldError}>{state.fieldErrors.unit}</p> : null}
        </div>
        <Submit pending={pending}>Test sign-in</Submit>
        <button type="submit" name="intent" value="use-code" formNoValidate className={styles.textButton}>
          Use an SMS code instead
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className={styles.form} key="phone" noValidate>
      <input type="hidden" name="intent" value="request" />
      <Logo appName={appName} />
      <div className={styles.headingBlock}>
        <h1 className={styles.heading}>
          Welcome to
          <br />
          {appName}
        </h1>
        <p className={styles.subheading}>Sign in with the phone number your landlord has on record.</p>
      </div>
      {expiredLink ? (
        <p role="status" className={styles.notice}>
          That link has expired. Sign in with your phone number instead.
        </p>
      ) : null}
      <Message state={state} />

      <div className={styles.field}>
        <label htmlFor="phone" className={styles.label}>Phone number</label>
        <div className={styles.inputWrap}>
          <Phone className={styles.inputIcon} aria-hidden="true" />
          <span className={styles.prefix} aria-hidden="true">+254</span>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            required
            defaultValue={state.typedPhone}
            placeholder="712 345 678"
            aria-invalid={state.error ? true : undefined}
            className={`${styles.input} ${styles.inputWithPrefix}`}
          />
        </div>
      </div>

      <Submit pending={pending}>Send me a code</Submit>

      <div className={styles.divider} aria-hidden="true">or</div>

      <Link href="/admin/login" className={styles.secondary}>
        <ShieldCheck width={18} height={18} aria-hidden="true" />
        Admin login
      </Link>

      {testSignIn ? (
        <button type="submit" name="intent" value="use-unit" formNoValidate className={styles.testLink}>
          <FlaskConical width={16} height={16} aria-hidden="true" /> Test sign-in (sandbox): phone + unit code
        </button>
      ) : null}

      <p className={styles.paybill}>
        Or pay from M-Pesa: Paybill <strong>{paybill}</strong>, account = your unit code.
      </p>

      <div className={styles.footer}>
        <p className={styles.footnote}>
          <LockKeyhole className={styles.footnoteIcon} aria-hidden="true" />
          We&apos;ll text you a 6-digit code to sign in.
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
