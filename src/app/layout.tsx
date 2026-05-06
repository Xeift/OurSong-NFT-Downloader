import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "OurSong NFT Downloader",
  description: "Export OurSong creator NFTs and holder lists.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}
