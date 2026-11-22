import { TenantShell } from "@/components/tenants/tenant-shell";
import { getEnvironment } from "@/configuration/environment";
import { currentTenantLease } from "../current-lease";

/** Signed-in tenant screens: the same dark frame as the landlord app, with only the tenant's own pages. */
export default async function TenantSignedInLayout({ children }: { children: React.ReactNode }) {
  const { lease } = await currentTenantLease();
  return (
    <TenantShell
      appName={getEnvironment().APP_NAME}
      tenantName={lease?.tenantName ?? "Tenant"}
      unitCode={lease?.unitCode ?? null}
      buildingName={lease?.buildingName ?? null}
      canPay={Boolean(lease?.isCurrent)}
    >
      {lease ? children : <p className="rounded-[14px] border bg-card p-5 text-text-secondary">We couldn&apos;t find a lease for your number. Please contact your landlord.</p>}
    </TenantShell>
  );
}
