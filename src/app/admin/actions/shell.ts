"use server";

import { requireLandlord } from "@/authentication/roles";
import { attentionItems, type AttentionItem } from "@/services/reports";
import { searchEverything, type SearchResult } from "@/services/search";

/** The ⌘K search: tenants, units and payments matching the text. */
export async function searchAction(text: string): Promise<SearchResult[]> {
  await requireLandlord();
  if (typeof text !== "string") return [];
  return searchEverything({ text });
}

/** Full "needs attention" list for the bell popover — loaded on open so every tab switch stays fast. */
export async function loadAttentionAction(): Promise<{ items: AttentionItem[]; total: number }> {
  await requireLandlord();
  const attention = await attentionItems({ limit: 8 });
  return { items: attention.items, total: attention.total };
}
