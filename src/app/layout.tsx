import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Subspace",
  description: "A shared space for you and your agents.",
  appleWebApp: { capable: true, title: "Subspace", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d10" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="ambient" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </div>
        {children}
      </body>
    </html>
  );
}
