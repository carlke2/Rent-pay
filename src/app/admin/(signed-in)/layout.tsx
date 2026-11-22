import { cookies } from "next/headers";
import { requireLandlord } from "@/authentication/roles";
import { AdminShell } from "@/components/admin/admin-shell";
import { SIDEBAR_COOKIE } from "@/components/admin/sidebar-preference";
import { getEnvironment } from "@/configuration/environment";
import { adminShellSummary } from "@/services/reports";
import { getLandlordProfile } from "@/services/tenancy";
import { currentPeriod } from "@/utilities/dates";

/** The landlord app: dark theme, sidebar (rail or drawer), top bar with search, month, help and notifications. */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const session = await requireLandlord();
  const [profile, summary, cookieStore] = await Promise.all([getLandlordProfile(session.subject), adminShellSummary(), cookies()]);
  return (
    <AdminShell
      appName={getEnvironment().APP_NAME}
      landlordName={profile?.name ?? "Landlord"}
      email={profile?.email ?? ""}
      buildings={summary.buildings}
      paymentsBadge={summary.paymentsBadge}
      readingsBadge={summary.readingsBadge}
      attention={{ items: summary.attention.items, total: summary.attention.total }}
      initialCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === "collapsed"}
      currentPeriod={currentPeriod()}
    >
      {children}
    </AdminShell>
  );
}
