import type { Metadata } from "next";
import { PayFlow } from "@/components/tenants/pay-flow";
import { PaybillCard } from "@/components/tenants/paybill-card";
import { TenantHeading } from "@/components/tenants/tenant-heading";
import { getEnvironment } from "@/configuration/environment";
import { leaseBalance } from "@/services/tenancy";
import { formatShillings } from "@/utilities/money";
import { currentTenantLease } from "../../current-lease";

export const metadata: Metadata = { title: "Pay" };

export default async function PayPage({ searchParams }: PageProps<"/tenants/pay">) {
  const [{ lease }, query] = await Promise.all([currentTenantLease(), searchParams]);
  if (!lease) return null;
  const paybill = getEnvironment().MPESA_SHORTCODE;
  if (!lease.isCurrent) {
    return (
      <>
        <TenantHeading title="Pay" description="This lease has ended. Contact your landlord about any balance." />
        <PaybillCard paybill={paybill} account={lease.unitCode} />
      </>
    );
  }
  const balance = await leaseBalance(lease.leaseId);
  // From the bill card's "Pay now": prefill the amount it showed (whole shillings, M-Pesa's 1–250,000 range).
  const requested = typeof query.amount === "string" && /^\d{1,6}$/.test(query.amount) ? Number(query.amount) : null;
  const prefill = requested && requested >= 1 && requested <= 250_000 ? requested : balance > 0 ? balance : 1;
  return (
    <>
      <TenantHeading title="Pay rent" description={balance > 0 ? `You owe ${formatShillings(balance)}.` : "Nothing is due right now. You can still pay ahead."} />
      <PayFlow defaultAmount={prefill} defaultPhone={`0${lease.tenantPhone.slice(3)}`} paybill={paybill} account={lease.unitCode} />
    </>
  );
}
