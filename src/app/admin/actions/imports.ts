"use server";

import { z } from "zod";
import type { ActionState } from "@/components/shared/action-types";
import { dryRunImport, runImport } from "@/services/imports";
import { isoDate, runAction } from "./run";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const schema = z.object({
  intent: z.enum(["check", "import"]),
  file: z
    .instanceof(File, { error: "Choose the filled-in template (.xlsx)" })
    .refine((file) => file.size <= MAX_FILE_BYTES, "The file must be 5 MB or smaller")
    .refine((file) => /\.xlsx$/i.test(file.name), "Upload the .xlsx template (not .xls or .csv)"),
  cutOver: isoDate("the cut-over date"),
  differencesChecked: z.literal("on").optional(),
  textTenants: z.literal("on").optional(),
});

/** Settings → Import. "check" is the dry run (writes nothing); "import" saves it, one transaction per unit. */
export async function importOpeningBalancesAction(_state: ActionState, formData: FormData) {
  const intent = formData.get("intent");
  return runAction(
    schema,
    formData,
    async (input, { actor }) => {
      const bytes = await input.file.arrayBuffer();
      if (input.intent === "check") {
        const preview = await dryRunImport({ bytes, fileName: input.file.name, cutOver: input.cutOver });
        const problems = preview.errors.length;
        return {
          message: problems ? `${problems} problem${problems === 1 ? "" : "s"} to fix` : "No problems found. Review the preview, then import.",
          data: { kind: "preview", preview },
        };
      }
      const result = await runImport({
        bytes,
        fileName: input.file.name,
        cutOver: input.cutOver,
        differencesChecked: input.differencesChecked === "on",
        textTenants: input.textTenants === "on",
        actor,
      });
      const failed = result.failed.length;
      return {
        message: `${result.imported} unit${result.imported === 1 ? "" : "s"} imported${failed ? `, ${failed} failed` : ""}`,
        data: { kind: "result", result },
      };
    },
    { revalidate: intent === "import" },
  );
}
