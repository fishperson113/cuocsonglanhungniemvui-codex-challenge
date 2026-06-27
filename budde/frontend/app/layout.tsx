import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sale/Marketing Kanban",
  description: "AI dispatcher Kanban board",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script src="https://cdn.tailwindcss.com"></script>
        <script src="https://encore.dev/encore-toolbar.js"></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
