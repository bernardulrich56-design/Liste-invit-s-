import { Guest } from '../types';

function escapeCsvCell(value: string): string {
  const safe = String(value ?? '').replace(/"/g, '""');
  return `"${safe}"`;
}

function buildExportRows(guests: Guest[], isAdmin: boolean) {
  const headers = isAdmin
    ? [
        'N°',
        'Nom et Prénoms',
        'Nationalité',
        'N° Passeport',
        'Prise en charge Bilili',
        'Note prise en charge',
        'Statut accueil',
        'Date arrivée prévue',
        'Vol / Heure',
        'Hôtel',
        'Navette / Chauffeur',
        'Programme / Dédicaces',
        'Arrivée enregistrée le',
        'Notes',
      ]
    : [
        'N°',
        'Nom et Prénoms',
        'Nationalité',
        'Prise en charge Bilili',
        'Note prise en charge',
        'Programme / Dédicaces',
        'Statut accueil',
        'Arrivée enregistrée le',
      ];

  const rows = guests.map((g) => {
    const arrival = g.checkedInAt
      ? new Date(g.checkedInAt).toLocaleString('fr-FR')
      : '';
    if (isAdmin) {
      return [
        String(g.orderNumber),
        g.fullName,
        g.nationality,
        g.passportNumber || '',
        g.fullCoverage ? 'Oui' : 'Non',
        g.coverageNote || '',
        g.checkedIn ? 'Reçu' : 'En attente',
        g.arrivalDate || '',
        g.arrivalFlight || '',
        g.hotelName || '',
        g.driverName || '',
        g.programSchedule || '',
        arrival,
        g.notes || '',
      ];
    }
    return [
      String(g.orderNumber),
      g.fullName,
      g.nationality,
      g.fullCoverage ? 'Oui' : 'Non',
      g.coverageNote || '',
      g.programSchedule || '',
      g.checkedIn ? 'Reçu' : 'En attente',
      arrival,
    ];
  });

  return { headers, rows };
}

export function exportGuestsToCSV(guests: Guest[], isAdmin: boolean): void {
  const { headers, rows } = buildExportRows(guests, isAdmin);

  const csvLines = [headers, ...rows].map((row) =>
    row.map(escapeCsvCell).join(';')
  );
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvLines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bilili-bd-2026-invites-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportGuestsToExcel(
  guests: Guest[],
  isAdmin: boolean
): Promise<void> {
  const XLSX = await import('xlsx');
  const { headers, rows } = buildExportRows(guests, isAdmin);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet['!cols'] = headers.map((_, idx) => ({
    wch: idx === 1 ? 30 : idx === 11 || idx === 13 ? 34 : 18,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Invités Bilili 2026');
  XLSX.writeFile(
    wb,
    `bilili-bd-2026-invites-${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}

export interface ImportedGuestRow {
  fullName: string;
  nationality: string;
  passportNumber: string;
  fullCoverage: boolean;
  coverageNote: string;
  arrivalDate?: string;
  arrivalFlight?: string;
  hotelName?: string;
  driverName?: string;
  programSchedule?: string;
}

function mapSpreadsheetRows(matrix: string[][]): ImportedGuestRow[] {
  if (matrix.length === 0) return [];
  const firstCells = (matrix[0] || []).map((c) => String(c || '').toLowerCase());
  const hasHeader = firstCells.some(
    (c) =>
      c.includes('nom') ||
      c.includes('nationalit') ||
      c.includes('passeport') ||
      c.includes('name')
  );

  // Detect optional named columns if header exists
  const findCol = (keywords: string[]) =>
    hasHeader
      ? firstCells.findIndex((c) => keywords.some((k) => c.includes(k)))
      : -1;

  const colName = findCol(['nom', 'name']);
  const colNat = findCol(['nationalit', 'pays', 'country']);
  const colPass = findCol(['passeport', 'passport']);
  const colCov = findCol(['prise en charge', 'coverage', 'bilili']);
  const colArrDate = findCol(['date arriv', 'arrival date']);
  const colFlight = findCol(['vol', 'flight']);
  const colHotel = findCol(['hôtel', 'hotel', 'héberg']);
  const colDriver = findCol(['chauffeur', 'navette', 'driver']);
  const colProg = findCol(['programme', 'dédicace', 'atelier', 'schedule']);

  const dataRows = hasHeader ? matrix.slice(1) : matrix;
  const results: ImportedGuestRow[] = [];

  for (const rawRow of dataRows) {
    const cols = rawRow.map((c) => String(c ?? '').trim());
    if (cols.every((c) => !c)) continue;

    const startsWithNumber = /^\d+$/.test(cols[0] || '');
    const fullName =
      (colName >= 0 ? cols[colName] : startsWithNumber ? cols[1] : cols[0])?.trim() ||
      '';
    const nationality =
      (colNat >= 0 ? cols[colNat] : startsWithNumber ? cols[2] : cols[1])?.trim() ||
      'Non précisée';
    const passportNumber =
      (colPass >= 0 ? cols[colPass] : startsWithNumber ? cols[3] : cols[2])?.trim() ||
      '';
    const coverageRaw =
      (colCov >= 0 ? cols[colCov] : startsWithNumber ? cols[4] : cols[3])?.toLowerCase() ||
      '';
    const fullCoverage =
      coverageRaw.includes('oui') ||
      coverageRaw.includes('yes') ||
      coverageRaw.includes('bilili') ||
      coverageRaw === 'true' ||
      coverageRaw === '1';

    if (fullName.length >= 2) {
      results.push({
        fullName: fullName.slice(0, 160),
        nationality: nationality.slice(0, 80),
        passportNumber: passportNumber.slice(0, 40),
        fullCoverage,
        coverageNote: fullCoverage ? 'Prise en charge complète Bilili' : '',
        arrivalDate: colArrDate >= 0 ? cols[colArrDate].slice(0, 20) : '',
        arrivalFlight: colFlight >= 0 ? cols[colFlight].slice(0, 120) : '',
        hotelName: colHotel >= 0 ? cols[colHotel].slice(0, 160) : '',
        driverName: colDriver >= 0 ? cols[colDriver].slice(0, 160) : '',
        programSchedule: colProg >= 0 ? cols[colProg].slice(0, 300) : '',
      });
    }
  }

  return results;
}

export function parseGuestsCsv(csvText: string): ImportedGuestRow[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';

  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  return mapSpreadsheetRows(lines.map(splitRow));
}

export async function parseGuestsSpreadsheet(
  file: File
): Promise<ImportedGuestRow[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    const sheet = workbook.Sheets[firstSheetName];
    const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
    });
    return mapSpreadsheetRows(matrix);
  }

  const text = await file.text();
  return parseGuestsCsv(text);
}
