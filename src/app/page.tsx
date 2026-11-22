import { redirect } from "next/navigation";

/** The app opens on landlord sign-in. Tenants use the link on that page. */
export default function HomePage() {
  redirect("/admin/login");
}
