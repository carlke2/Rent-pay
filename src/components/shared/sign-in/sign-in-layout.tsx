import Image from "next/image";
import { Logo } from "@/components/shared/logo";
import { SignInPromo, type SignInPromoMessage } from "./sign-in-promo";
import styles from "./sign-in.module.css";

export function SignInLayout({
  children,
  messages,
}: {
  children: React.ReactNode;
  messages: SignInPromoMessage[];
}) {
  return (
    <main className={styles.page}>
      <div className={styles.background} aria-hidden="true">
        <Image src="/sign-in.jpg" alt="" fill priority sizes="100vw" className={styles.backgroundImage} />
        <div className={styles.overlay} />
      </div>
      <div className={styles.layout}>
        <div className={styles.promoArea}>
          <div className={styles.promoLogo}>
            <Logo variant="dark" kind="full" height={28} priority />
          </div>
          <SignInPromo messages={messages} />
        </div>
        <div className={styles.panel}>
          <div className={styles.panelInner}>{children}</div>
        </div>
      </div>
    </main>
  );
}
