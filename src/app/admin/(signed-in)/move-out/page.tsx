import type { Metadata } from "next";
import { MoveOutWizard } from "@/components/admin/move-out-wizard";
import { PageHeader } from "@/components/shared/page-header";
import { listCurrentLeases } from "@/services/tenancy";
import { todayInNairobi } from "@/utilities/dates";

export const metadata: Metadata = { title: "Move out" };

export default async function MoveOutPage({ searchParams }: PageProps<"/admin/move-out">) {
  const { leaseId } = await searchParams;
  const leases = await listCurrentLeases();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Move out" description="Lease, final reading, deductions, then the deposit summary before you confirm." />
      <MoveOutWizard leases={leases} initialLeaseId={typeof leaseId === "string" ? leaseId : undefined} today={todayInNairobi()} />
    </div>
  );
}
