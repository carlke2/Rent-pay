import { ExpiredLinkCard } from "@/components/shared/expired-link-card";

/** Unknown receipt link: HTTP 404 with a way to find receipts. */
export default function ReceiptNotFound() {
  return (
    <ExpiredLinkCard
      title="Receipt not found"
      message="Check the link in your SMS, or sign in to see all your receipts."
      action={{ href: "/tenants/receipts", label: "Sign in to see receipts" }}
    />
  );
}
