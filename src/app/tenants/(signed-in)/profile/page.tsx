import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AvatarEditor } from "@/components/tenants/avatar-editor";
import { EditDetailsButton, ProfileDetails } from "@/components/tenants/profile-details";
import { avatarUrl } from "@/services/avatars";
import { getTenantProfile, getTenantProfileStats } from "@/services/portal";
import { formatPeriod } from "@/utilities/dates";
import { currentTenantLease } from "../../current-lease";

export const metadata: Metadata = { title: "Profile" };

/**
 * Layout: from 1024px two top-aligned columns (card 360px | details up to 520px), left-aligned in the page;
 * 768–1023px one centred 420px column; phones full width (16px page padding). Fits a 1366x700 screen unscrolled.
 */
export default async function ProfilePage() {
  const { tenantId, lease } = await currentTenantLease();
  const [profile, stats] = await Promise.all([getTenantProfile(tenantId), getTenantProfileStats(tenantId)]);
  if (!profile || !lease) return null;
  const photo = avatarUrl(tenantId, profile.avatarKey);
  // No payments yet (or no bill due yet): there's no on-time record, so show a dash rather than 0%.
  const onTime = stats.paymentsMade === 0 || stats.onTimePercent === null ? "—" : `${stats.onTimePercent}%`;
  const figures = [
    { value: String(stats.paymentsMade), label: "Payments" },
    { value: String(stats.monthsAsTenant), label: "Months here" },
    { value: onTime, label: "On time" },
  ];

  return (
    // 640–767px the page padding is 24px; pull back to 16px. From md the column centres; from lg two columns.
    <div className="sm:-mx-2 md:mx-auto md:max-w-[420px] lg:mx-0 lg:flex lg:max-w-none lg:items-start lg:gap-6">
      {/* Phones and tablets reach Profile from the More tab: keep the way back. */}
      <Link prefetch={false} href="/tenants/more" className="-mt-2 mb-2 -ml-2 inline-grid size-11 place-items-center rounded-full text-heading no-underline hover:bg-surface-muted lg:hidden print:hidden" aria-label="Back">
        <ArrowLeft className="size-5" aria-hidden />
      </Link>

      <section aria-label="Your profile" className="overflow-hidden rounded-[20px] border bg-card lg:w-[360px] lg:shrink-0">
        <div className="relative h-24 bg-gradient-to-br from-[#0A0A0A] to-[#1C1C1F]">
          {/* Bottom-left, inside the band, starting right of the avatar that overlaps the band's lower 40px. */}
          <p className="absolute right-4 bottom-2.5 left-[112px] truncate text-sm font-semibold tracking-[0.06em] text-[#F5F0E6]/80 [font-variant-caps:all-small-caps]">{lease.buildingName}</p>
        </div>

        <div className="p-5">
          <div className="-mt-[60px] flex items-end justify-between gap-3">
            <AvatarEditor name={profile.fullName} avatarUrl={photo} />
            <EditDetailsButton />
          </div>

          <h1 className="mt-3 font-display text-2xl leading-tight font-normal tracking-[-0.01em] text-heading">{profile.fullName}</h1>
          <div className="mt-1 grid gap-1 text-sm text-muted-foreground">
            <p>
              <span className="numbers">{lease.unitCode}</span> · {lease.buildingName}
            </p>
            {stats.tenantSince ? <p>Tenant since {formatPeriod(stats.tenantSince.slice(0, 7))}</p> : null}
          </div>

          <dl className="mt-4 grid grid-cols-3 divide-x border-t pt-4">
            {figures.map((figure) => (
              <div key={figure.label} className="flex flex-col-reverse items-center text-center">
                <dt className="mt-0.5 text-xs text-muted-foreground">{figure.label}</dt>
                <dd className="numbers text-lg leading-tight font-semibold text-heading">{figure.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="contact-details" aria-labelledby="contact-heading" className="mt-6 min-w-0 scroll-mt-24 lg:mt-0 lg:max-w-[520px] lg:flex-1">
        <h2 id="contact-heading" className="mb-3 text-base font-semibold text-heading">
          Contact details
        </h2>
        <ProfileDetails phone={profile.phone} alternativePhone={profile.alternativePhone} whatsappOptIn={profile.whatsappOptIn} />
      </section>
    </div>
  );
}
