import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'DVF Explorer — Transactions Immobilières',
  description:
    'Explorez les données DVF (Demandes de Valeurs Foncières) avec une interface moderne. Analysez les transactions immobilières françaises.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={`${inter.className} antialiased`}>{children}</body>
    </html>
  );
}
