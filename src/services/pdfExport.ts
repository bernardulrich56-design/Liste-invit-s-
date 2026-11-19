import { Guest } from '../types';

export async function exportGuestsToPDF(
  guests: Guest[],
  filterLabel: string,
  includePassports = true
) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const now = new Date();
  const formattedDate = now.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Header band in Bilili Emerald Green
  doc.setFillColor(5, 150, 105);
  doc.rect(0, 0, 297, 26, 'F');

  // Accent stripe in Bilili Orange
  doc.setFillColor(234, 88, 12);
  doc.rect(0, 26, 297, 2.5, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('LISTE DES PRÉSENCES — BILILI BD FESTIVAL 2026', 14, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Lettres d’invitation — Institut français du Congo', 14, 19);
  doc.text(`Exporté le ${formattedDate}`, 283, 19, { align: 'right' });

  // Summary metrics bar
  const total = guests.length;
  const receivedCount = guests.filter((g) => g.checkedIn).length;
  const pendingCount = total - receivedCount;
  const coverageCount = guests.filter((g) => g.fullCoverage).length;

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `Filtre : ${filterLabel}   |   Total affiché : ${total}   |   Invités reçus : ${receivedCount}   |   En attente : ${pendingCount}   |   Prise en charge Bilili : ${coverageCount}`,
    14,
    36
  );

  const headRow = includePassports
    ? [
        'N°',
        'Nom et Prénoms',
        'Nationalité',
        'N° Passeport',
        'Prise en charge',
        "Statut d'accueil",
        "Date / Heure d'accueil",
      ]
    : [
        'N°',
        'Nom et Prénoms',
        'Nationalité',
        'Prise en charge',
        "Statut d'accueil",
        "Date / Heure d'accueil",
      ];

  const rows = guests.map((g) => {
    const arrivalTime = g.checkedInAt
      ? new Date(g.checkedInAt).toLocaleString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';
    const coverageText = g.fullCoverage
      ? g.coverageNote || 'Prise en charge Bilili'
      : 'Standard';
    const statusText = g.checkedIn ? 'Reçu' : 'En attente';

    return includePassports
      ? [
          String(g.orderNumber),
          g.fullName,
          g.nationality,
          g.passportNumber || '—',
          coverageText,
          statusText,
          arrivalTime,
        ]
      : [
          String(g.orderNumber),
          g.fullName,
          g.nationality,
          coverageText,
          statusText,
          arrivalTime,
        ];
  });

  const statusColumnIndex = includePassports ? 5 : 4;

  autoTable(doc, {
    startY: 41,
    head: [headRow],
    body: rows,
    styles: {
      fontSize: 8.5,
      cellPadding: 3,
      textColor: [30, 41, 59],
      lineColor: [203, 213, 225],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [5, 150, 105],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: includePassports
      ? {
          0: { cellWidth: 12, halign: 'center' },
          1: { cellWidth: 75, fontStyle: 'bold' },
          2: { cellWidth: 32 },
          3: { cellWidth: 32 },
          4: { cellWidth: 48 },
          5: { cellWidth: 28, halign: 'center' },
          6: { cellWidth: 40 },
        }
      : {
          0: { cellWidth: 14, halign: 'center' },
          1: { cellWidth: 88, fontStyle: 'bold' },
          2: { cellWidth: 38 },
          3: { cellWidth: 56 },
          4: { cellWidth: 30, halign: 'center' },
          5: { cellWidth: 43 },
        },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === statusColumnIndex) {
        const val = String(data.cell.raw);
        if (val === 'Reçu') {
          data.cell.styles.textColor = [5, 150, 105];
          data.cell.styles.fontStyle = 'bold';
        } else {
          data.cell.styles.textColor = [234, 88, 12];
        }
      }
    },
  });

  doc.save(`bilili-bd-festival-2026-presences-${now.toISOString().slice(0, 10)}.pdf`);
}
