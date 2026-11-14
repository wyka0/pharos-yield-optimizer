import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Pharos Apex — Horizon-Aware Net-Yield Optimizer & Non-Custodial Rebalance Desk",
  description:
    "Block-pinned 3-vault yield comparison, break-even-aware rebalance verdicts and non-custodial unsigned transaction bundles for the Pharos Atlantic Testnet (chainId 688689). The agent never holds keys — transactions are prepared for user wallet signature only.",
};

const themeInit = `
try {
  var t = localStorage.getItem("apex-theme");
  if (t === "dark") { document.documentElement.classList.add("dark"); }
  else { document.documentElement.classList.remove("dark"); }
} catch (e) { document.documentElement.classList.remove("dark"); }
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
