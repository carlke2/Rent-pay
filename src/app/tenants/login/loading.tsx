/** Shown while the sign-in page loads: the same dark backdrop, so there is no white flash. */
export default function Loading() {
  return <main className="min-h-dvh bg-[#1c1a18]" aria-busy="true" aria-label="Loading" />;
}
