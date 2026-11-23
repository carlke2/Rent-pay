import { DetailSkeleton } from "@/components/shared/list-skeleton";

/** Shown at once when the page is opened, while its data loads. */
export default function Loading() {
  return <DetailSkeleton />;
}
