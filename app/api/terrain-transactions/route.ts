import { extractDepartmentFromInsee, isDepartmentExcluded } from '@/lib/sanitize';
import { fetchTerrainSales, clampYears } from '@/lib/terrain-data';

export const maxDuration = 30;

// Liste COMPLÈTE des ventes de terrain nu d'une catégorie pour une commune
// (le tool du chat plafonne à 10 transactions par groupe pour épargner des
// tokens au modèle ; ici on sert le frontend directement, sans le modèle).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const insee = searchParams.get('insee') ?? '';
  const category = searchParams.get('category') ?? '';
  const yearFrom = Number(searchParams.get('yearFrom')) || undefined;
  const yearTo = Number(searchParams.get('yearTo')) || undefined;

  if (!/^[0-9][0-9AB][0-9]{3}$/.test(insee) || !category || category.length > 60) {
    return Response.json({ error: 'Paramètres invalides' }, { status: 400 });
  }
  const dept = extractDepartmentFromInsee(insee);
  if (isDepartmentExcluded(dept)) {
    return Response.json({ error: 'Département non couvert par le DVF' }, { status: 400 });
  }

  const { startYear, endYear } = clampYears(yearFrom, yearTo);

  try {
    const sales = await fetchTerrainSales({ insee, dept, startYear, endYear });
    const transactions = sales
      .filter(s => s.category === category)
      .sort((a, b) => new Date(b.date_mutation).getTime() - new Date(a.date_mutation).getTime())
      .map(({ year, category: _cat, unit, natures, parcelles, ...t }) => t);

    return Response.json({ count: transactions.length, transactions });
  } catch (error) {
    console.error('terrain-transactions error:', error);
    return Response.json({ error: 'Récupération des transactions échouée' }, { status: 500 });
  }
}
