import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'DVF Explorer - Transactions immobilières françaises',
  description:
    'Consultez les prix de vente immobiliers en France. Données officielles DVF de la DGFiP. Recherchez par adresse les transactions de 2021 à 2025.',
  keywords:
    'DVF, prix immobilier, transaction immobilière, valeur foncière, DGFiP, prix au m², achat immobilier France',
  openGraph: {
    title: 'DVF Explorer - Transactions immobilières françaises',
    description:
      'Consultez les prix de vente immobiliers en France par adresse. Données officielles DGFiP.',
    url: 'https://dvf.tkoidra.com',
    siteName: 'DVF Explorer',
    locale: 'fr_FR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DVF Explorer - Prix immobiliers France',
    description: 'Transactions immobilières françaises par adresse. Données DVF officielles.',
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: 'https://dvf.tkoidra.com',
  },
  verification: {
    google: '-4qm4cLQ2hPYqh23O0cc_IKeevJbhrlb1-YNfZQWgtc',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={`${inter.className} antialiased`}>{children}</body>
    </html>
  );
}
