import type { Metadata } from "next";
import "./globals.css";
import { WorkspaceShell } from "@/components/workspace-shell";

export const metadata: Metadata = {
  title: "Vcreation",
  description: "Plan, preview, generate and assemble short films with reusable cast references and clear cost records.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={"bg-[var(--bg)] text-[var(--text)] antialiased"}>
        <WorkspaceShell>{children}</WorkspaceShell>
      </body>
    </html>
  );
}
