import { Guest } from '../types';

async function loadImageAsJpegDataUrl(src: string): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith('data:image/jpeg')) return src;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 240;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        // Center-crop square portrait prioritizing top-center
        const minSide = Math.min(img.width, img.height);
        const sx = Math.max(0, (img.width - minSide) / 2);
        const sy = Math.max(0, (img.height - minSide) * 0.2);
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function getInitials(name: string): string {
  const cleaned = name.replace(/^(M\.|Mme|Mlle)\s+/i, '').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'BB';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export async function exportGuestBadgesPDF(
  guests: Guest[],
  titleSuffix = 'tous'
): Promise<void> {
  if (guests.length === 0) return;

  const [{ default: jsPDF }, QRCode] = await Promise.all([
    import('jspdf'),
    import('qrcode'),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const pageH = 297;
  const marginX = 12;
  const marginY = 14;
  const gapX = 8;
  const gapY = 10;
  const cardW = (pageW - marginX * 2 - gapX) / 2; // 89mm
  const cardH = (pageH - marginY * 2 - gapY) / 2; // 129.5mm

  // Preload QR codes and portraits
  const prepared = await Promise.all(
    guests.map(async (guest) => {
      const qrPayload = `BILILI-GUEST:${guest.id}`;
      const [qrDataUrl, portraitDataUrl] = await Promise.all([
        QRCode.toDataURL(qrPayload, {
          width: 240,
          margin: 1,
          color: { dark: '#0F172A', light: '#FFFFFF' },
        }),
        loadImageAsJpegDataUrl(guest.photoUrl),
      ]);
      return { guest, qrDataUrl, portraitDataUrl };
    })
  );

  prepared.forEach(({ guest, qrDataUrl, portraitDataUrl }, index) => {
    if (index > 0 && index % 4 === 0) {
      doc.addPage();
    }

    const slot = index % 4;
    const col = slot % 2;
    const row = Math.floor(slot / 2);
    const x = marginX + col * (cardW + gapX);
    const y = marginY + row * (cardH + gapY);

    // Card background & outer cut border
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, y, cardW, cardH, 4, 4, 'FD');

    // Header band in Bilili Emerald
    doc.setFillColor(5, 150, 105);
    doc.roundedRect(x, y, cardW, 21, 4, 4, 'F');
    doc.rect(x, y + 14, cardW, 7, 'F');

    // Orange accent stripe
    doc.setFillColor(234, 88, 12);
    doc.rect(x, y + 21, cardW, 2, 'F');

    // Lanyard punch hole guide
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(x + cardW / 2 - 7, y + 2.8, 14, 3, 1.5, 1.5, 'FD');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('BILILI BD FESTIVAL 2026', x + cardW / 2, y + 11.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('Institut français du Congo · Brazzaville', x + cardW / 2, y + 17.5, {
      align: 'center',
    });

    // Portrait frame
    const imgSize = 34;
    const imgX = x + (cardW - imgSize) / 2;
    const imgY = y + 27;

    if (portraitDataUrl) {
      doc.addImage(portraitDataUrl, 'JPEG', imgX, imgY, imgSize, imgSize);
      doc.setDrawColor(5, 150, 105);
      doc.setLineWidth(0.6);
      doc.rect(imgX, imgY, imgSize, imgSize);
    } else {
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(imgX, imgY, imgSize, imgSize, 3, 3, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(getInitials(guest.fullName), x + cardW / 2, imgY + 20, { align: 'center' });
    }

    // Badge Index Pill
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(x + cardW / 2 - 11, imgY + imgSize + 3, 22, 5.5, 1.5, 1.5, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(
      `INVITÉ N° ${String(guest.orderNumber).padStart(2, '0')}`,
      x + cardW / 2,
      imgY + imgSize + 6.9,
      { align: 'center' }
    );

    // Guest Full Name
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    const nameLines = doc.splitTextToSize(guest.fullName, cardW - 12);
    doc.text(nameLines.slice(0, 2), x + cardW / 2, imgY + imgSize + 14.5, {
      align: 'center',
    });

    // Nationality & Program
    const afterNameY = imgY + imgSize + 14.5 + Math.min(nameLines.length, 2) * 4.8;
    doc.setTextColor(5, 150, 105);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(guest.nationality.toUpperCase(), x + cardW / 2, afterNameY + 1, {
      align: 'center',
    });

    if (guest.fullCoverage) {
      doc.setTextColor(234, 88, 12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text(
        (guest.coverageNote || 'Prise en charge complète Bilili').slice(0, 44),
        x + cardW / 2,
        afterNameY + 6,
        { align: 'center' }
      );
    }

    // Bottom QR Check-in Strip
    const qrBoxY = y + cardH - 31;
    doc.setFillColor(244, 247, 251);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x + 5, qrBoxY, cardW - 10, 26, 2.5, 2.5, 'FD');

    doc.addImage(qrDataUrl, 'PNG', x + 7.5, qrBoxY + 2, 22, 22);

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('CHECK-IN ACCUEIL QR', x + 32, qrBoxY + 7.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    const progText = guest.programSchedule
      ? guest.programSchedule.slice(0, 56)
      : 'Présentez ce badge QR à l’accueil de l’IFC pour validation immédiate.';
    const progLines = doc.splitTextToSize(progText, cardW - 40);
    doc.text(progLines.slice(0, 3), x + 32, qrBoxY + 12.5);
  });

  const safeSuffix = titleSuffix.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  doc.save(`bilili-bd-2026-badges-${safeSuffix}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
