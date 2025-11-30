import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Layout from "../components/Layout";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Illuvrse Marketplace",
  description: "The official marketplace for Illuvrse.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Layout>{children}</Layout>
      </body>
    </html>
  );
}
