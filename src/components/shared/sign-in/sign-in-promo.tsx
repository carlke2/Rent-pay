"use client";

import { useEffect, useState } from "react";
import styles from "./sign-in.module.css";

export type SignInPromoMessage = { heading: string; text: string };

export function SignInPromo({ messages }: { messages: SignInPromoMessage[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || paused) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % messages.length), 6000);
    return () => window.clearInterval(timer);
  }, [paused, messages.length]);

  const message = messages[index] ?? messages[0]!;
  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className={styles.promo} aria-live="polite">
        <h2 className={styles.promoTitle}>{message.heading}</h2>
        <hr className={styles.promoRule} />
        <p className={styles.promoText}>{message.text}</p>
      </div>
      <div className={styles.dots}>
        {messages.map((m, i) => (
          <button
            key={m.heading}
            type="button"
            className={styles.dotButton}
            aria-label={`Show message ${i + 1}`}
            aria-pressed={i === index}
            onClick={() => setIndex(i)}
          >
            <span className={`${styles.dot} ${i === index ? styles.dotActive : ""}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
