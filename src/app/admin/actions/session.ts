"use server";

import { redirect } from "next/navigation";
import { destroySession } from "@/authentication/session";

export async function signOutLandlord(): Promise<never> {
  await destroySession("landlord");
  redirect("/admin/login");
}
