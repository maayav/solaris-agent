import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "Red Team Agent Swarm - Security Assessment",
    description: "AI-powered penetration testing with coordinated multi-agent system",
    icons: {
        icon: "/favicon.svg",
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className={`${inter.className} antialiased`}>
                <div className="flex h-screen bg-dark-900">
                    {children}
                </div>
            </body>
        </html>
    );
}
