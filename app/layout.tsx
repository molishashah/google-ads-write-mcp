import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Google Ads Write MCP",
  description: "MCP server for Google Ads write operations",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
