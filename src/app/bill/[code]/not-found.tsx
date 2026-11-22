import { ExpiredLinkCard } from "@/components/shared/expired-link-card";

/** Unknown or expired bill link: HTTP 404 with a way back in. */
export default function BillNotFound() {
  return <ExpiredLinkCard title="This link has expired" message="Sign in to see your bill." action={{ href: "/tenants/login", label: "Sign in" }} />;
}
