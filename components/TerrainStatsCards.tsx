'use client';

import React from 'react';
import {
  TerrainStats,
  TerrainGroup,
  TerrainTransaction,
  fmtPrixM2,
  fmtEuros,
  fmtDate,
  displayCategory,
  CATEGORY_TERRAIN_A_BATIR,
} from '@/lib/terrain';

// Couleur des barres : teinte de la charte TKoidra (#0D1F40) éclaircie pour
// rester dans la bande de lisibilité validée (contraste + daltonisme).
const BAR_COLOR = '#2E4E8E';

const CARD: React.CSSProperties = {
  backgroundColor: 'white',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius)',
  padding: '18px 20px',
  marginBottom: '12px',
};

function priceLabel(g: TerrainGroup): string {
  if (g.reliable) return `${fmtPrixM2(g.medianPricePerM2)} €/m²`;
  if (g.count === 1) return `${fmtPrixM2(g.medianPricePerM2)} €/m²`;
  return `${fmtPrixM2(g.minPricePerM2)}–${fmtPrixM2(g.maxPricePerM2)} €/m²`;
}

function TransactionList({ transactions }: { transactions: TerrainTransaction[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
      {transactions.map((t, i) => (
        <li
          key={i}
          style={{
            fontSize: '13px',
            color: 'var(--gray-500)',
            padding: '5px 0',
            borderTop: '1px solid var(--gray-100)',
          }}
        >
          <span style={{ color: 'var(--gray-700)' }}>{fmtDate(t.date_mutation)}</span>
          {' · '}{fmtEuros(t.surface_terrain)} m²
          {' · '}{fmtEuros(t.valeur_fonciere)} €
          {' · '}<span style={{ color: 'var(--gray-700)' }}>{fmtPrixM2(t.prix_m2)} €/m²</span>
          {t.adresse_nom_voie ? ` · ${t.adresse_nom_voie}` : ''}
        </li>
      ))}
    </ul>
  );
}

function CategoryCard({ category, groups }: { category: string; groups: TerrainGroup[] }) {
  // Groupes déjà triés par année décroissante par l'API
  const headline = groups.find(g => g.reliable) ?? groups[0];
  const maxMedian = Math.max(...groups.map(g => g.medianPricePerM2), 1);
  const transactions = groups
    .flatMap(g => g.transactions)
    .sort((a, b) => new Date(b.date_mutation).getTime() - new Date(a.date_mutation).getTime())
    .slice(0, 10);
  const totalVentes = groups.reduce((sum, g) => sum + g.count, 0);

  return (
    <div style={CARD}>
      <p style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gray-500)', margin: 0 }}>
        {displayCategory(category)}
      </p>

      <p style={{ margin: '6px 0 14px', display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '26px', fontWeight: 700, color: 'var(--gray-900)' }}>
          {priceLabel(headline)}
        </span>
        <span style={{ fontSize: '13px', color: 'var(--gray-500)' }}>
          {headline.reliable ? 'médiane' : 'fourchette'} {headline.year} · {totalVentes} vente{totalVentes > 1 ? 's' : ''} au total
        </span>
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
        {groups.map(g => (
          <div
            key={g.year}
            title={`Surface médiane ${fmtEuros(g.medianSurface)} m²`}
            style={{ display: 'grid', gridTemplateColumns: '38px minmax(60px, 1fr) auto', alignItems: 'center', gap: '10px' }}
          >
            <span style={{ fontSize: '13px', color: 'var(--gray-500)' }}>{g.year}</span>
            <div style={{ height: '8px', backgroundColor: 'var(--gray-100)', borderRadius: '0 4px 4px 0' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.max((g.medianPricePerM2 / maxMedian) * 100, 2)}%`,
                  backgroundColor: BAR_COLOR,
                  opacity: g.reliable ? 1 : 0.35,
                  borderRadius: '0 4px 4px 0',
                }}
              />
            </div>
            <span style={{ fontSize: '13px', color: 'var(--gray-700)', textAlign: 'right' }}>
              {priceLabel(g)}
              <span style={{ color: 'var(--gray-400)' }}> · {g.count} vente{g.count > 1 ? 's' : ''}</span>
              {!g.reliable && (
                <span style={{ color: 'var(--gray-400)' }} title="Moins de 5 ventes : à interpréter avec prudence"> ⚠</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {transactions.length > 0 && (
        <details style={{ marginTop: '14px' }}>
          <summary style={{ fontSize: '13px', color: 'var(--gray-500)', cursor: 'pointer' }}>
            Voir les {transactions.length} dernières transactions
          </summary>
          <TransactionList transactions={transactions} />
        </details>
      )}
    </div>
  );
}

export function TerrainStatsCards({ stats }: { stats: TerrainStats }) {
  if (!stats.byCategory || stats.byCategory.length === 0) return null;

  // Regroupe les lignes catégorie×année par catégorie (ordre API conservé :
  // catégorie alphabétique, années décroissantes)
  const byCat = new Map<string, TerrainGroup[]>();
  for (const g of stats.byCategory) {
    const list = byCat.get(g.category);
    if (list) list.push(g); else byCat.set(g.category, [g]);
  }

  // Terrain à bâtir en premier, puis par volume de ventes décroissant
  const cards = [...byCat.entries()].sort((a, b) => {
    if (a[0] === CATEGORY_TERRAIN_A_BATIR) return -1;
    if (b[0] === CATEGORY_TERRAIN_A_BATIR) return 1;
    const ventes = (e: [string, TerrainGroup[]]) => e[1].reduce((s, g) => s + g.count, 0);
    return ventes(b) - ventes(a);
  });

  const years = stats.byCategory.map(g => g.year);
  const period = `${[...years].sort()[0]}–${[...years].sort().at(-1)}`;
  const hasTerrainABatir = byCat.has(CATEGORY_TERRAIN_A_BATIR);

  return (
    <div style={{ marginTop: '16px' }}>
      {cards.map(([category, groups]) => (
        <CategoryCard key={category} category={category} groups={groups} />
      ))}

      <p style={{ fontSize: '12.5px', color: 'var(--gray-400)', lineHeight: 1.55, margin: '14px 0 0' }}>
        Période {period} · Données DVF/DGFiP, mises à jour avec environ 6 mois de décalage ·
        Prix médians par vente (valeur totale ÷ surface totale) · ⚠ = moins de 5 ventes, à interpréter avec prudence.
        {hasTerrainABatir && (
          <>
            <br />
            « Terrain à bâtir » reflète la déclaration faite au moment de la vente, pas le statut du terrain au titre du PLU.
          </>
        )}
        <br />
        <a
          href="https://app.dvf.etalab.gouv.fr/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: BAR_COLOR, textDecoration: 'underline', textUnderlineOffset: '2px' }}
        >
          Vérifier sur la carte DVF officielle
        </a>
      </p>
    </div>
  );
}
