import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";
import { THEME_STORAGE_KEY } from "@/components/shared/theme-key";
import { Toaster } from "@/components/shared/ui/sonner";
import { getEnvironment } from "@/configuration/environment";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const DESCRIPTION = "Rent payments and receipts";

/**
 * Generic metadata for every page: never amounts, names, unit codes or phone numbers (link previews in
 * messaging apps show these). Every route is noindex, nofollow; public/robots.txt also disallows all.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { APP_NAME: appName, APP_URL } = getEnvironment();
  let metadataBase: URL | undefined;
  try {
    metadataBase = new URL(APP_URL);
  } catch {
    metadataBase = undefined;
  }
  const image = { url: "/icons/icon-512.png", width: 512, height: 512, alt: appName };
  return {
    metadataBase,
    applicationName: appName,
    title: { default: appName, template: `%s · ${appName}` },
    description: DESCRIPTION,
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
    appleWebApp: { capable: true, title: appName, statusBarStyle: "black-translucent" },
    formatDetection: { telephone: false, email: false, address: false },
    openGraph: { type: "website", siteName: appName, title: appName, description: DESCRIPTION, images: [image] },
    twitter: { card: "summary", title: appName, description: DESCRIPTION, images: [image.url] },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets pages draw under the notch; headers and bars pad themselves with env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: "#111111",
};

/** Runs before first paint so the signed-in apps don't flash the wrong theme. Dark unless the user chose light. */
const THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")!=="light")document.documentElement.classList.add("dark")}catch(e){document.documentElement.classList.add("dark")}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the script below adds .dark before React hydrates.
    <html lang="en-KE" className={`${instrumentSerif.variable} ${instrumentSans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans">
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
