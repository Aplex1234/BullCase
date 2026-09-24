import type { Metadata } from "next";
import "@carbon/styles/css/styles.css";
import "./globals.css";
import "./premium.css";
import "./analyst-workspace.css";
import "./research-chat.css";

export const metadata: Metadata = {
  title: "BullCase | Equity Research Terminal",
  description: "Transparent financial analysis, valuation and risk scoring grounded in public filings.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

