import type { Metadata } from "next";
import { LogOut } from "lucide-react";
import { signOutTenant } from "@/app/tenants/actions/session";
import { ProfileDetails } from "@/components/tenants/profile-details";
import { TenantCard, TenantHeading } from "@/components/tenants/tenant-heading";
import { getTenantProfile } from "@/services/portal";
import { currentTenantLease } from "../../current-lease";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { tenantId, lease } = await currentTenantLease();
  const profile = await getTenantProfile(tenantId);
  if (!profile || !lease) return null;
  return (
    <div className="grid gap-4">
      <TenantHeading title="Profile" back="/tenants/more" />
      <TenantCard>
        <p className="text-sm text-muted-foreground">Name</p>
        <p className="text-lg font-semibold text-heading">{profile.fullName}</p>
        <p className="mt-3 text-sm text-muted-foreground">Unit</p>
        <p className="numbers text-lg font-semibold text-heading">{lease.unitCode}</p>
      </TenantCard>
      <ProfileDetails phone={profile.phone} alternativePhone={profile.alternativePhone} whatsappOptIn={profile.whatsappOptIn} />
      <form action={signOutTenant}>
        <button type="submit" className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card font-medium text-destructive hover:bg-surface-muted">
          <LogOut className="size-5" aria-hidden /> Log out
        </button>
      </form>
    </div>
  );
}
