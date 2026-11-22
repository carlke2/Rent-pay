import type { MetadataRoute } from "next";
import { getEnvironment } from "@/configuration/environment";

/** Installable tenant portal: opens on /tenants. */
export default function manifest(): MetadataRoute.Manifest {
  const appName = getEnvironment().APP_NAME;
  return {
    name: appName,
    short_name: appName.length > 12 ? appName.slice(0, 12).trim() : appName,
    description: "Rent payments and receipts",
    start_url: "/tenants",
    scope: "/",
    display: "standalone",
    background_color: "#0A0A0A",
    theme_color: "#0A0A0A",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
