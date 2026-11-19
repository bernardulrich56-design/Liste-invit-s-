import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Calendar,
  CalendarPlus,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileDown,
  FileSpreadsheet,
  LayoutGrid,
  List,
  Maximize2,
  Plane,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import {
  FESTIVAL_MASCOT_URL,
  getPublicAppUrl,
  UPLOADED_PORTRAIT_GALLERY,
} from '../data/initialData';
import { exportGuestBadgesPDF } from '../services/badgePdfExport';
import {
  exportGuestsToExcel,
  ImportedGuestRow,
  parseGuestsSpreadsheet,
} from '../services/csvUtils';
import { exportGuestsToPDF } from '../services/pdfExport';
import { Appointment, Guest } from '../types';
import { NationalityChartPanel } from './NationalityChartPanel';

const LazyQRScannerModal = React.lazy(() =>
  import('./QRScannerModal').then((m) => ({ default: m.QRScannerModal }))
);

interface GuestRegistryProps {
  guests: Guest[];
  appointments: Appointment[];
  isAdmin: boolean;
  isAuthReady: boolean;
  isSigningIn: boolean;
  onAdminSignIn: () => void;
  onToggleCheckIn: (guest: Guest) => Promise<void>;
  onUpdateGuest: (
    guestId: string,
    updates: Partial<
      Pick<
        Guest,
        | 'fullName'
        | 'nationality'
        | 'passportNumber'
        | 'fullCoverage'
        | 'coverageNote'
        | 'photoUrl'
        | 'notes'
        | 'arrivalDate'
        | 'arrivalFlight'
        | 'hotelName'
        | 'driverName'
        | 'programSchedule'
      >
    >
  ) => Promise<void>;
  onAddGuest: (
    newGuest: Omit<Guest, 'id' | 'orderNumber' | 'allowedAdminEmails' | 'updatedBy'>
  ) => Promise<void>;
  onImportGuests: (rows: ImportedGuestRow[]) => Promise<number>;
  onDeleteGuest: (guest: Guest) => Promise<void>;
  onPlanAppointmentForGuest: (guestName: string) => void;
  shareModalOpen: boolean;
  onSetShareModalOpen: (open: boolean) => void;
}

type GuestFilter = 'all' | 'checked_in' | 'pending' | 'coverage' | 'today_arrivals';

function getInitials(name: string): string {
  const cleaned = name.replace(/^(M\.|Mme|Mlle)\s+/i, '').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'BB';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^(m\.|mme|mlle|monsieur|madame)\s+/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 480;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Impossible de traiter l’image.'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      };
      img.onerror = () => reject(new Error('Fichier image invalide.'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(file);
  });
}

export const GuestRegistry: React.FC<GuestRegistryProps> = ({
  guests,
  appointments,
  isAdmin,
  onToggleCheckIn,
  onUpdateGuest,
  onAddGuest,
  onImportGuests,
  onDeleteGuest,
  onPlanAppointmentForGuest,
  shareModalOpen,
  onSetShareModalOpen,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<GuestFilter>('all');
  const [selectedNationality, setSelectedNationality] = useState('');
  const [showChartPanel, setShowChartPanel] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [lightboxGuest, setLightboxGuest] = useState<Guest | null>(null);
  const [photoModalGuest, setPhotoModalGuest] = useState<Guest | null>(null);
  const [deleteConfirmGuest, setDeleteConfirmGuest] = useState<Guest | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [generatingBadges, setGeneratingBadges] = useState(false);

  const [shareTarget, setShareTarget] = useState<'all' | 'booking' | 'tracking'>('all');
  const [shareMessage, setShareMessage] = useState(
    "Bonjour ! Voici le lien officiel de l’application Bilili BD Festival 2026 (Institut français du Congo) pour consulter la liste des invités et prendre un rendez-vous avec Monsieur Jean-Jacques, Vénicia ou Madame Joël :"
  );
  const [copiedState, setCopiedState] = useState<'link' | 'message' | null>(null);

  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackInfo, setFeedbackInfo] = useState<string | null>(null);
  const [brokenImageIds, setBrokenImageIds] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  // Add guest form state
  const [newName, setNewName] = useState('');
  const [newNationality, setNewNationality] = useState('');
  const [newPassport, setNewPassport] = useState('');
  const [newFullCoverage, setNewFullCoverage] = useState(false);
  const [newCoverageNote, setNewCoverageNote] = useState('');
  const [newPhotoUrl, setNewPhotoUrl] = useState('');
  const [newArrivalDate, setNewArrivalDate] = useState('');
  const [newArrivalFlight, setNewArrivalFlight] = useState('');
  const [newHotelName, setNewHotelName] = useState('');
  const [newDriverName, setNewDriverName] = useState('');
  const [newProgramSchedule, setNewProgramSchedule] = useState('');
  const [adding, setAdding] = useState(false);

  // Edit notes & details state inside detail modal (with real-time auto-save)
  const [editFullName, setEditFullName] = useState('');
  const [editNationality, setEditNationality] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editPassport, setEditPassport] = useState('');
  const [editCoverageNote, setEditCoverageNote] = useState('');
  const [editFullCoverage, setEditFullCoverage] = useState(false);
  const [editArrivalDate, setEditArrivalDate] = useState('');
  const [editArrivalFlight, setEditArrivalFlight] = useState('');
  const [editHotelName, setEditHotelName] = useState('');
  const [editDriverName, setEditDriverName] = useState('');
  const [editProgramSchedule, setEditProgramSchedule] = useState('');
  const [modalAutoSaveState, setModalAutoSaveState] = useState<
    'idle' | 'pending' | 'saving' | 'saved'
  >('idle');
  const [modalSavedTime, setModalSavedTime] = useState<string | null>(null);
  const skipNextAutoSaveRef = useRef(false);

  const shareUrl = useMemo(() => {
    const base = getPublicAppUrl();
    if (shareTarget === 'booking') return `${base}?tab=booking`;
    if (shareTarget === 'tracking') return `${base}?tab=tracking`;
    return base;
  }, [shareTarget]);

  const fullWhatsAppText = useMemo(
    () => `${shareMessage.trim()}\n${shareUrl}`,
    [shareMessage, shareUrl]
  );

  const whatsappHref = useMemo(
    () => `https://wa.me/?text=${encodeURIComponent(fullWhatsAppText)}`,
    [fullWhatsAppText]
  );

  const handleSelectShareTarget = (target: 'all' | 'booking' | 'tracking') => {
    setShareTarget(target);
    if (target === 'all') {
      setShareMessage(
        "Bonjour ! Voici le lien officiel de l’application Bilili BD Festival 2026 (Institut français du Congo) pour consulter la liste des invités et prendre un rendez-vous avec Monsieur Jean-Jacques, Vénicia ou Madame Joël :"
      );
    } else if (target === 'booking') {
      setShareMessage(
        "Bonjour ! Vous pouvez réserver un moment d’échange ou prendre rendez-vous avec Monsieur Jean-Jacques, Vénicia ou Madame Joël (Bilili BD Festival 2026) via ce lien :"
      );
    } else {
      setShareMessage(
        "Bonjour ! Consultez l’avancement et la validation de votre rendez-vous Bilili BD Festival 2026 via ce lien :"
      );
    }
  };

  const handleCopyShare = async (mode: 'link' | 'message') => {
    try {
      await navigator.clipboard.writeText(mode === 'link' ? shareUrl : fullWhatsAppText);
      setCopiedState(mode);
      window.setTimeout(() => setCopiedState(null), 2500);
    } catch {
      setFeedbackError('Copie automatique impossible sur ce navigateur.');
    }
  };

  const todayIsoDate = new Date().toISOString().slice(0, 10);

  const stats = useMemo(() => {
    const total = guests.length;
    const received = guests.filter((g) => g.checkedIn).length;
    const pending = total - received;
    const coverage = guests.filter((g) => g.fullCoverage).length;
    const todayArrivals = guests.filter(
      (g) =>
        g.arrivalDate === todayIsoDate ||
        (g.checkedInAt && g.checkedInAt.slice(0, 10) === todayIsoDate)
    ).length;
    const percent = total > 0 ? Math.round((received / total) * 100) : 0;
    return { total, received, pending, coverage, todayArrivals, percent };
  }, [guests, todayIsoDate]);

  // Map guest ID -> linked appointments (Organizer only)
  const linkedAppointmentsByGuest = useMemo(() => {
    const map: Record<string, Appointment[]> = {};
    if (!isAdmin || appointments.length === 0) return map;

    for (const guest of guests) {
      const guestNorm = normalizePersonName(guest.fullName);
      if (!guestNorm) continue;
      const guestTokens = guestNorm.split(' ').filter((t) => t.length >= 3);
      const matched = appointments.filter((appt) => {
        const reqNorm = normalizePersonName(appt.requesterName);
        if (!reqNorm) return false;
        if (reqNorm.includes(guestNorm) || guestNorm.includes(reqNorm)) return true;
        if (guestTokens.length >= 2) {
          const overlap = guestTokens.filter((t) => reqNorm.includes(t));
          return overlap.length >= 2;
        }
        return false;
      });
      if (matched.length > 0) {
        map[guest.id] = matched;
      }
    }
    return map;
  }, [guests, appointments, isAdmin]);

  const filteredGuests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return guests.filter((g) => {
      if (filter === 'checked_in' && !g.checkedIn) return false;
      if (filter === 'pending' && g.checkedIn) return false;
      if (filter === 'coverage' && !g.fullCoverage) return false;
      if (filter === 'today_arrivals') {
        const matchesToday =
          g.arrivalDate === todayIsoDate ||
          (g.checkedInAt && g.checkedInAt.slice(0, 10) === todayIsoDate);
        if (!matchesToday) return false;
      }
      if (
        selectedNationality &&
        (g.nationality || 'Non précisée').trim() !== selectedNationality
      ) {
        return false;
      }
      if (!q) return true;
      return (
        g.fullName.toLowerCase().includes(q) ||
        g.nationality.toLowerCase().includes(q) ||
        (g.programSchedule || '').toLowerCase().includes(q) ||
        (isAdmin &&
          (g.passportNumber.toLowerCase().includes(q) ||
            (g.hotelName || '').toLowerCase().includes(q) ||
            (g.arrivalFlight || '').toLowerCase().includes(q)))
      );
    });
  }, [guests, searchQuery, filter, selectedNationality, todayIsoDate, isAdmin]);

  const filterLabelMap: Record<GuestFilter, string> = {
    all: 'Tous les invités',
    checked_in: 'Invités reçus',
    pending: 'En attente d’arrivée',
    coverage: 'Prise en charge complète Bilili',
    today_arrivals: 'Arrivées du jour',
  };

  const handleToggle = async (guest: Guest) => {
    setFeedbackError(null);
    setSavingId(guest.id);
    try {
      await onToggleCheckIn(guest);
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Erreur lors de la mise à jour.');
    } finally {
      setSavingId(null);
    }
  };

  const handleAssignPhoto = async (guest: Guest, url: string) => {
    setFeedbackError(null);
    setSavingId(guest.id);
    try {
      await onUpdateGuest(guest.id, { photoUrl: url });
      setBrokenImageIds((prev) => ({ ...prev, [guest.id]: false }));
      setPhotoModalGuest(null);
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Erreur lors de l’association.');
    } finally {
      setSavingId(null);
    }
  };

  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>, guest: Guest) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedbackError(null);
    try {
      const compressed = await compressImageFile(file);
      await handleAssignPhoto(guest, compressed);
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Erreur lors du chargement de la photo.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedbackError(null);
    setFeedbackInfo(null);
    setImportingCsv(true);
    try {
      const rows = await parseGuestsSpreadsheet(file);
      if (rows.length === 0) {
        setFeedbackError(
          'Aucune ligne valide détectée. Vérifiez les colonnes : Nom et Prénoms ; Nationalité ; Passeport.'
        );
        return;
      }
      const addedCount = await onImportGuests(rows);
      setFeedbackInfo(
        `${addedCount} invité(s) importé(s) depuis ${file.name} et enregistré(s) automatiquement sur Firebase.`
      );
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Erreur lors de l’import Excel / CSV.');
    } finally {
      setImportingCsv(false);
      if (csvInputRef.current) csvInputRef.current.value = '';
    }
  };

  const handleExportBadges = async (targetGuests: Guest[], suffix: string) => {
    setFeedbackError(null);
    setGeneratingBadges(true);
    try {
      await exportGuestBadgesPDF(targetGuests, suffix);
      setFeedbackInfo(`Badge(s) QR PDF généré(s) avec succès (${targetGuests.length}).`);
    } catch (err) {
      setFeedbackError(
        err instanceof Error ? err.message : 'Impossible de générer les badges PDF.'
      );
    } finally {
      setGeneratingBadges(false);
    }
  };

  const openGuestDetail = (guest: Guest) => {
    skipNextAutoSaveRef.current = true;
    setSelectedGuest(guest);
    setEditFullName(guest.fullName || '');
    setEditNationality(guest.nationality || '');
    setEditNotes(guest.notes || '');
    setEditPassport(guest.passportNumber || '');
    setEditFullCoverage(guest.fullCoverage);
    setEditCoverageNote(guest.coverageNote || '');
    setEditArrivalDate(guest.arrivalDate || '');
    setEditArrivalFlight(guest.arrivalFlight || '');
    setEditHotelName(guest.hotelName || '');
    setEditDriverName(guest.driverName || '');
    setEditProgramSchedule(guest.programSchedule || '');
    setModalAutoSaveState('idle');
    setModalSavedTime(null);
  };

  const hasDetailChanges = useMemo(() => {
    if (!selectedGuest) return false;
    return (
      editFullName.trim() !== (selectedGuest.fullName || '').trim() ||
      editNationality.trim() !== (selectedGuest.nationality || '').trim() ||
      editPassport.trim() !== (selectedGuest.passportNumber || '').trim() ||
      editNotes.trim() !== (selectedGuest.notes || '').trim() ||
      editFullCoverage !== selectedGuest.fullCoverage ||
      editCoverageNote.trim() !== (selectedGuest.coverageNote || '').trim() ||
      editArrivalDate.trim() !== (selectedGuest.arrivalDate || '').trim() ||
      editArrivalFlight.trim() !== (selectedGuest.arrivalFlight || '').trim() ||
      editHotelName.trim() !== (selectedGuest.hotelName || '').trim() ||
      editDriverName.trim() !== (selectedGuest.driverName || '').trim() ||
      editProgramSchedule.trim() !== (selectedGuest.programSchedule || '').trim()
    );
  }, [
    selectedGuest,
    editFullName,
    editNationality,
    editPassport,
    editNotes,
    editFullCoverage,
    editCoverageNote,
    editArrivalDate,
    editArrivalFlight,
    editHotelName,
    editDriverName,
    editProgramSchedule,
  ]);

  const flushDetailSave = async () => {
    if (!selectedGuest || !isAdmin) return;
    if (!editFullName.trim() || !editNationality.trim()) return;
    if (!hasDetailChanges) return;

    setModalAutoSaveState('saving');
    setSavingId(selectedGuest.id);
    const payload = {
      fullName: editFullName.trim(),
      nationality: editNationality.trim(),
      notes: editNotes.trim(),
      passportNumber: editPassport.trim(),
      fullCoverage: editFullCoverage,
      coverageNote: editCoverageNote.trim(),
      arrivalDate: editArrivalDate.trim(),
      arrivalFlight: editArrivalFlight.trim(),
      hotelName: editHotelName.trim(),
      driverName: editDriverName.trim(),
      programSchedule: editProgramSchedule.trim(),
    };
    try {
      await onUpdateGuest(selectedGuest.id, payload);
      setSelectedGuest((prev) => (prev ? { ...prev, ...payload } : null));
      setModalAutoSaveState('saved');
      setModalSavedTime(
        new Date().toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    } catch (err) {
      setModalAutoSaveState('idle');
      setFeedbackError(err instanceof Error ? err.message : 'Impossible d’enregistrer.');
    } finally {
      setSavingId(null);
    }
  };

  // Debounced auto-save on every edit inside Guest Detail Modal (Organizer only)
  useEffect(() => {
    if (!selectedGuest || !isAdmin) return;
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }
    if (!hasDetailChanges) return;
    if (!editFullName.trim() || !editNationality.trim()) return;

    setModalAutoSaveState('pending');
    const timer = window.setTimeout(() => {
      void flushDetailSave();
    }, 650);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedGuest?.id,
    isAdmin,
    editFullName,
    editNationality,
    editPassport,
    editNotes,
    editFullCoverage,
    editCoverageNote,
    editArrivalDate,
    editArrivalFlight,
    editHotelName,
    editDriverName,
    editProgramSchedule,
  ]);

  const handleCloseDetailModal = async () => {
    await flushDetailSave();
    setSelectedGuest(null);
  };

  const handleSaveDetail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGuest) return;
    if (!editFullName.trim() || !editNationality.trim()) {
      setFeedbackError('Le nom complet et la nationalité sont obligatoires.');
      return;
    }
    setFeedbackError(null);
    await flushDetailSave();
    setSelectedGuest(null);
  };

  const handleCreateGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newNationality.trim()) return;
    setAdding(true);
    setFeedbackError(null);
    try {
      await onAddGuest({
        fullName: newName.trim(),
        nationality: newNationality.trim(),
        passportNumber: newPassport.trim(),
        fullCoverage: newFullCoverage,
        coverageNote:
          newCoverageNote.trim() ||
          (newFullCoverage ? 'Prise en charge complète Bilili' : ''),
        photoUrl: newPhotoUrl,
        checkedIn: false,
        checkedInAt: '',
        notes: '',
        arrivalDate: newArrivalDate.trim(),
        arrivalFlight: newArrivalFlight.trim(),
        hotelName: newHotelName.trim(),
        driverName: newDriverName.trim(),
        programSchedule: newProgramSchedule.trim(),
      });
      setNewName('');
      setNewNationality('');
      setNewPassport('');
      setNewFullCoverage(false);
      setNewCoverageNote('');
      setNewPhotoUrl('');
      setNewArrivalDate('');
      setNewArrivalFlight('');
      setNewHotelName('');
      setNewDriverName('');
      setNewProgramSchedule('');
      setAddModalOpen(false);
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Erreur lors de l’ajout.');
    } finally {
      setAdding(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmGuest) return;
    setDeleting(true);
    setFeedbackError(null);
    try {
      await onDeleteGuest(deleteConfirmGuest);
      if (selectedGuest?.id === deleteConfirmGuest.id) {
        setSelectedGuest(null);
      }
      setDeleteConfirmGuest(null);
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Erreur lors de la suppression.');
    } finally {
      setDeleting(false);
    }
  };

  // SVG Circular Gauge constants (radius 30, circumference ~188.5)
  const gaugeRadius = 30;
  const gaugeCircumference = 2 * Math.PI * gaugeRadius;
  const gaugeOffset =
    gaugeCircumference - (stats.percent / 100) * gaugeCircumference;

  return (
    <div className="space-y-6">
      {/* Top Hero Banner with Aesthetic Progress Dial */}
      <section className="bg-white border border-slate-300/90 rounded-2xl p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2.5 max-w-2xl">
            <p className="text-xs font-semibold tracking-wider uppercase text-emerald-700">
              Institut français du Congo · Suivi officiel des présences
            </p>
            <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 text-balance leading-tight">
              Recensement &amp; Accueil des Invités Bilili BD Festival 2026
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              Visualisez chaque invité avec son portrait, suivez les arrivées en
              temps réel et synchronisez automatiquement chaque modification
              dans Firebase.
            </p>
          </div>

          {/* Aesthetic Reception Dial & Mascot */}
          <div className="flex items-center gap-5 bg-[#F4F7FB] border border-slate-300/80 rounded-2xl p-4 sm:p-5 shrink-0">
            <div className="relative w-20 h-20 flex items-center justify-center shrink-0">
              <svg
                className="w-20 h-20 -rotate-90"
                viewBox="0 0 76 76"
                aria-hidden="true"
              >
                <circle
                  cx="38"
                  cy="38"
                  r={gaugeRadius}
                  fill="none"
                  stroke="#CBD5E1"
                  strokeWidth="6.5"
                />
                <circle
                  cx="38"
                  cy="38"
                  r={gaugeRadius}
                  fill="none"
                  stroke="#059669"
                  strokeWidth="6.5"
                  strokeLinecap="round"
                  strokeDasharray={gaugeCircumference}
                  strokeDashoffset={gaugeOffset}
                  className="transition-all duration-500"
                />
              </svg>
              <span className="absolute font-display text-base font-bold text-slate-900 tabular-nums">
                {stats.percent}%
              </span>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-500">
                Cadran d’accueil
              </div>
              <div className="font-display text-2xl font-bold text-slate-900 tabular-nums">
                {stats.received} / {stats.total} reçus
              </div>
              <div className="text-xs font-medium text-orange-700 tabular-nums">
                {stats.pending} en attente d’arrivée
              </div>
            </div>

            <img
              src={FESTIVAL_MASCOT_URL}
              alt="Mascotte Bilili BD Festival"
              referrerPolicy="no-referrer"
              className="hidden sm:block w-16 h-16 rounded-xl object-cover bg-slate-900 ring-1 ring-slate-900/10 shadow-xs shrink-0"
            />
          </div>
        </div>

        {/* 4-Column Interactive Metric Dials */}
        <div className="mt-6 pt-6 border-t border-slate-200 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`text-left rounded-xl p-4 border transition-all ${
              filter === 'all'
                ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                : 'bg-[#F4F7FB] border-slate-200 hover:border-slate-400 text-slate-900'
            }`}
          >
            <div
              className={`text-xs font-medium ${
                filter === 'all' ? 'text-slate-300' : 'text-slate-500'
              }`}
            >
              Total des invités
            </div>
            <div className="mt-1.5 font-display text-2xl font-bold tabular-nums">
              {stats.total}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setFilter('checked_in')}
            className={`text-left rounded-xl p-4 border transition-all ${
              filter === 'checked_in'
                ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                : 'bg-emerald-50/75 border-emerald-200 hover:border-emerald-400 text-emerald-950'
            }`}
          >
            <div
              className={`text-xs font-medium ${
                filter === 'checked_in' ? 'text-emerald-100' : 'text-emerald-800'
              }`}
            >
              Invités reçus
            </div>
            <div
              className={`mt-1.5 font-display text-2xl font-bold tabular-nums ${
                filter === 'checked_in' ? 'text-white' : 'text-emerald-700'
              }`}
            >
              {stats.received}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setFilter('pending')}
            className={`text-left rounded-xl p-4 border transition-all ${
              filter === 'pending'
                ? 'bg-orange-600 text-white border-orange-600 shadow-xs'
                : 'bg-orange-50/75 border-orange-200 hover:border-orange-400 text-orange-950'
            }`}
          >
            <div
              className={`text-xs font-medium ${
                filter === 'pending' ? 'text-orange-100' : 'text-orange-800'
              }`}
            >
              En attente d’arrivée
            </div>
            <div
              className={`mt-1.5 font-display text-2xl font-bold tabular-nums ${
                filter === 'pending' ? 'text-white' : 'text-orange-700'
              }`}
            >
              {stats.pending}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setFilter('coverage')}
            className={`text-left rounded-xl p-4 border transition-all ${
              filter === 'coverage'
                ? 'bg-slate-800 text-white border-slate-800 shadow-xs'
                : 'bg-[#F4F7FB] border-slate-200 hover:border-slate-400 text-slate-900'
            }`}
          >
            <div
              className={`text-xs font-medium ${
                filter === 'coverage' ? 'text-slate-300' : 'text-slate-500'
              }`}
            >
              Prise en charge Bilili
            </div>
            <div className="mt-1.5 font-display text-2xl font-bold tabular-nums">
              {stats.coverage}
            </div>
          </button>
        </div>
      </section>

      {feedbackError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-300 text-red-800 rounded-xl px-4 py-3 text-sm flex items-center justify-between gap-3"
        >
          <span>{feedbackError}</span>
          <button
            type="button"
            onClick={() => setFeedbackError(null)}
            className="text-red-700 hover:text-red-900 font-semibold text-xs"
          >
            Fermer
          </button>
        </div>
      )}

      {feedbackInfo && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl px-4 py-3 text-sm flex items-center justify-between gap-3"
        >
          <span>{feedbackInfo}</span>
          <button
            type="button"
            onClick={() => setFeedbackInfo(null)}
            className="text-emerald-800 hover:text-emerald-950 font-semibold text-xs"
          >
            Fermer
          </button>
        </div>
      )}

      {/* Search, Filter & Export Toolbar */}
      <section className="bg-white border border-slate-300/90 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xs">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          {/* Quick Search by Name */}
          <div className="relative flex-1 max-w-xl">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                isAdmin
                  ? 'Recherche rapide par nom, nationalité ou N° de passeport...'
                  : 'Recherche rapide par nom ou nationalité...'
              }
              aria-label="Recherche rapide par nom"
              className="w-full h-11 pl-10 pr-4 bg-[#F4F7FB] border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 focus:bg-white transition-colors"
            />
          </div>

          {/* Primary toolbar actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex items-center p-1 bg-[#F4F7FB] border border-slate-200 rounded-xl">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  viewMode === 'grid'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Cartes visuelles
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  viewMode === 'table'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                Tableau
              </button>
            </div>

            <button
              type="button"
              onClick={() => onSetShareModalOpen(true)}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-emerald-600 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <Share2 className="w-4 h-4 text-emerald-700" />
              Partager WhatsApp
            </button>

            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 shadow-xs"
                >
                  <QrCode className="w-4 h-4" />
                  Scanner QR
                </button>

                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,text/csv"
                  className="hidden"
                  onChange={handleCsvImport}
                />
                <button
                  type="button"
                  disabled={importingCsv}
                  onClick={() => csvInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                  {importingCsv ? 'Import...' : 'Importer Excel'}
                </button>

                <button
                  type="button"
                  onClick={() => setAddModalOpen(true)}
                  className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4 text-emerald-700" />
                  Ajouter
                </button>
              </>
            )}

            <button
              type="button"
              disabled={generatingBadges || filteredGuests.length === 0}
              onClick={() => void handleExportBadges(filteredGuests, filterLabelMap[filter])}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <QrCode className="w-4 h-4 text-orange-600" />
              {generatingBadges ? 'Badges...' : 'Badges QR PDF'}
            </button>

            <button
              type="button"
              onClick={() => void exportGuestsToExcel(filteredGuests, isAdmin)}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-4 h-4 text-slate-700" />
              Excel (.xlsx)
            </button>

            <button
              type="button"
              onClick={() => void exportGuestsToPDF(filteredGuests, filterLabelMap[filter], isAdmin)}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 shadow-xs"
            >
              <FileDown className="w-4 h-4" />
              Exporter PDF
            </button>
          </div>
        </div>

        {/* Segmented Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200/80">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: 'all', label: `Tous (${stats.total})` },
                { id: 'checked_in', label: `Reçus (${stats.received})` },
                { id: 'pending', label: `En attente (${stats.pending})` },
                { id: 'coverage', label: `Prise en charge (${stats.coverage})` },
                { id: 'today_arrivals', label: `Arrivées du jour (${stats.todayArrivals})` },
              ] as { id: GuestFilter; label: string }[]
            ).map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'bg-[#F4F7FB] text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowChartPanel((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap ${
              showChartPanel || selectedNationality
                ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            {selectedNationality
              ? `Pays : ${selectedNationality}`
              : 'Statistiques par pays'}
          </button>
        </div>
      </section>

      {(showChartPanel || selectedNationality) && (
        <NationalityChartPanel
          guests={guests}
          activeNationality={selectedNationality}
          onSelectNationality={(nat) => setSelectedNationality(nat)}
        />
      )}

      {/* Guest Results */}
      {filteredGuests.length === 0 ? (
        <div className="bg-white border border-slate-300/90 rounded-2xl p-10 text-center space-y-3 shadow-xs">
          <p className="font-display text-lg font-semibold text-slate-900">
            Aucun invité ne correspond à votre recherche
          </p>
          <p className="text-sm text-slate-600">
            Essayez un autre nom ou réinitialisez les filtres actifs.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setFilter('all');
              setSelectedNationality('');
            }}
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold transition-colors"
          >
            Réinitialiser les filtres
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredGuests.map((guest) => {
            const showFallback = !guest.photoUrl || brokenImageIds[guest.id];
            const isBusy = savingId === guest.id;
            const linkedAppts = linkedAppointmentsByGuest[guest.id] || [];

            return (
              <article
                key={guest.id}
                className="group bg-white border border-slate-300/90 rounded-2xl overflow-hidden flex flex-col justify-between transition-all hover:border-slate-400 hover:shadow-md shadow-xs"
              >
                <div>
                  {/* Framed Portrait Header */}
                  <div className="relative h-60 bg-slate-900 overflow-hidden">
                    {!showFallback ? (
                      <>
                        <img
                          src={guest.photoUrl}
                          alt={guest.fullName}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setBrokenImageIds((prev) => ({ ...prev, [guest.id]: true }))
                          }
                          className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                        <div
                          aria-hidden="true"
                          className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-950/15 to-transparent pointer-events-none"
                        />
                      </>
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-slate-800 via-slate-900 to-emerald-950 flex flex-col items-center justify-center text-white p-4">
                        <div className="w-20 h-20 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center">
                          <span className="font-display text-3xl font-bold tracking-tight">
                            {getInitials(guest.fullName)}
                          </span>
                        </div>
                        <span className="mt-3 text-xs text-slate-300">
                          Portrait non renseigné
                        </span>
                      </div>
                    )}

                    {/* Top-left order index */}
                    <span className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-white/95 text-slate-900 font-mono text-xs font-bold tabular-nums shadow-xs">
                      N° {String(guest.orderNumber).padStart(2, '0')}
                    </span>

                    {/* Top-right controls */}
                    <div className="absolute top-3 right-3 flex items-center gap-1.5">
                      {!showFallback && (
                        <button
                          type="button"
                          onClick={() => setLightboxGuest(guest)}
                          title="Agrandir le portrait"
                          aria-label={`Agrandir le portrait de ${guest.fullName}`}
                          className="p-1.5 rounded-lg bg-slate-950/70 hover:bg-slate-950 text-white backdrop-blur-xs transition-colors"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => setPhotoModalGuest(guest)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950/75 hover:bg-slate-950 text-white text-xs font-medium backdrop-blur-xs transition-colors"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          {guest.photoUrl ? 'Changer' : 'Photo'}
                        </button>
                      )}
                    </div>

                    {/* Scrim overlay caption for clean portrait reading */}
                    <div className="absolute bottom-3 left-3.5 right-3.5 flex items-end justify-between gap-2 text-white">
                      <span className="text-xs font-medium text-slate-200 truncate">
                        {guest.nationality}
                      </span>
                      {linkedAppts.length > 0 && (
                        <span className="text-xs font-semibold text-emerald-300 whitespace-nowrap shrink-0">
                          {linkedAppts.length} RDV associé
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-5 space-y-3">
                    <div>
                      <h2 className="font-display text-base font-bold text-slate-900 leading-snug">
                        {guest.fullName}
                      </h2>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                        <span className="font-medium text-slate-800">{guest.nationality}</span>
                        {isAdmin && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              Passeport : {guest.passportNumber || 'Non renseigné'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {guest.fullCoverage && (
                      <p className="text-xs font-semibold text-orange-700">
                        {guest.coverageNote || 'Prise en charge complète Bilili'}
                      </p>
                    )}

                    {guest.programSchedule && (
                      <p className="text-xs text-emerald-800 bg-emerald-50/80 border border-emerald-200/80 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                        <span>{guest.programSchedule}</span>
                      </p>
                    )}

                    {isAdmin && (guest.arrivalFlight || guest.hotelName || guest.arrivalDate) && (
                      <p className="text-xs text-slate-600 flex items-start gap-1.5">
                        <Plane className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        <span className="truncate">
                          {[guest.arrivalDate, guest.arrivalFlight, guest.hotelName]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </p>
                    )}

                    {/* Reception Status Line */}
                    <div className="pt-2.5 border-t border-slate-200/80 flex items-center justify-between text-xs">
                      {guest.checkedIn ? (
                        <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          Reçu
                          {guest.checkedInAt && (
                            <span className="font-normal text-slate-500 tabular-nums">
                              ·{' '}
                              {new Date(guest.checkedInAt).toLocaleString('fr-FR', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-semibold text-orange-700">
                          <Clock className="w-4 h-4 shrink-0" />
                          En attente d’arrivée
                        </span>
                      )}

                      {isAdmin && (
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => openGuestDetail(guest)}
                            className="text-slate-700 hover:text-slate-950 font-semibold underline underline-offset-2"
                          >
                            Détails
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmGuest(guest)}
                            title="Supprimer cet invité"
                            aria-label={`Supprimer ${guest.fullName}`}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Footer Action (Organizer only) */}
                {isAdmin && (
                  <div className="px-5 pb-5">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleToggle(guest)}
                      className={`w-full h-10 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
                        guest.checkedIn
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-orange-600 hover:bg-orange-700 text-white'
                      } disabled:opacity-60`}
                    >
                      <UserCheck className="w-4 h-4" />
                      {isBusy
                        ? 'Enregistrement...'
                        : guest.checkedIn
                        ? 'Invité reçu (Annuler)'
                        : 'Marquer comme reçu'}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="bg-white border border-slate-300/90 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900 text-white text-xs font-semibold">
                  <th className="py-3.5 px-4 w-14">N°</th>
                  <th className="py-3.5 px-4 w-20">Portrait</th>
                  <th className="py-3.5 px-4">Nom et Prénoms</th>
                  <th className="py-3.5 px-4">Nationalité</th>
                  {isAdmin && <th className="py-3.5 px-4">N° Passeport</th>}
                  <th className="py-3.5 px-4">Prise en charge</th>
                  <th className="py-3.5 px-4">Statut d’accueil</th>
                  {isAdmin && <th className="py-3.5 px-4 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredGuests.map((guest) => {
                  const showFallback = !guest.photoUrl || brokenImageIds[guest.id];
                  const isBusy = savingId === guest.id;
                  return (
                    <tr key={guest.id} className="hover:bg-[#F4F7FB] transition-colors">
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-700 tabular-nums">
                        {String(guest.orderNumber).padStart(2, '0')}
                      </td>
                      <td className="py-3 px-4">
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => setPhotoModalGuest(guest)}
                            title="Associer ou changer la photo"
                            className="w-11 h-11 rounded-xl overflow-hidden border border-slate-300 bg-slate-100 flex items-center justify-center shrink-0"
                          >
                            {!showFallback ? (
                              <img
                                src={guest.photoUrl}
                                alt={guest.fullName}
                                referrerPolicy="no-referrer"
                                onError={() =>
                                  setBrokenImageIds((prev) => ({ ...prev, [guest.id]: true }))
                                }
                                className="w-full h-full object-cover object-top"
                              />
                            ) : (
                              <span className="text-xs font-bold text-emerald-800">
                                {getInitials(guest.fullName)}
                              </span>
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={showFallback}
                            onClick={() => !showFallback && setLightboxGuest(guest)}
                            className="w-11 h-11 rounded-xl overflow-hidden border border-slate-300 bg-slate-100 flex items-center justify-center shrink-0 disabled:cursor-default"
                          >
                            {!showFallback ? (
                              <img
                                src={guest.photoUrl}
                                alt={guest.fullName}
                                referrerPolicy="no-referrer"
                                onError={() =>
                                  setBrokenImageIds((prev) => ({ ...prev, [guest.id]: true }))
                                }
                                className="w-full h-full object-cover object-top"
                              />
                            ) : (
                              <span className="text-xs font-bold text-emerald-800">
                                {getInitials(guest.fullName)}
                              </span>
                            )}
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {guest.fullName}
                      </td>
                      <td className="py-3 px-4 text-slate-700">{guest.nationality}</td>
                      {isAdmin && (
                        <td className="py-3 px-4 font-mono text-xs text-slate-700 tabular-nums">
                          {guest.passportNumber || '—'}
                        </td>
                      )}
                      <td className="py-3 px-4 text-xs">
                        {guest.fullCoverage ? (
                          <span className="font-semibold text-orange-700">
                            {guest.coverageNote || 'Complète Bilili'}
                          </span>
                        ) : (
                          <span className="text-slate-500">Standard</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {guest.checkedIn ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                            <CheckCircle2 className="w-4 h-4" />
                            Reçu
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-orange-700">
                            <Clock className="w-4 h-4" />
                            En attente
                          </span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleToggle(guest)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors ${
                                guest.checkedIn
                                  ? 'bg-emerald-600 hover:bg-emerald-700'
                                  : 'bg-orange-600 hover:bg-orange-700'
                              }`}
                            >
                              {guest.checkedIn ? 'Reçu' : 'Marquer reçu'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openGuestDetail(guest)}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              Éditer
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmGuest(guest)}
                              title="Supprimer cet invité"
                              aria-label={`Supprimer ${guest.fullName}`}
                              className="p-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Portrait Lightbox Modal */}
      {lightboxGuest && lightboxGuest.photoUrl && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxGuest(null)}
        >
          <div
            className="bg-white border border-slate-300 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative bg-slate-900">
              <img
                src={lightboxGuest.photoUrl}
                alt={lightboxGuest.fullName}
                referrerPolicy="no-referrer"
                className="w-full max-h-[65vh] object-cover object-top"
              />
              <button
                type="button"
                onClick={() => setLightboxGuest(null)}
                aria-label="Fermer"
                className="absolute top-3 right-3 p-2 rounded-xl bg-slate-950/75 text-white hover:bg-slate-950"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-display font-bold text-slate-900">
                  {lightboxGuest.fullName}
                </p>
                <p className="text-xs text-slate-600">
                  N° {String(lightboxGuest.orderNumber).padStart(2, '0')} ·{' '}
                  {lightboxGuest.nationality}
                </p>
              </div>
              {lightboxGuest.checkedIn ? (
                <span className="text-xs font-bold text-emerald-700">Reçu</span>
              ) : (
                <span className="text-xs font-bold text-orange-700">En attente</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Photo Association Modal (Organizer only) */}
      {isAdmin && photoModalGuest && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="photo-modal-title"
        >
          <div className="bg-white border border-slate-300 rounded-2xl max-w-xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="photo-modal-title" className="font-display text-lg font-bold text-slate-900">
                  Associer une photo — {photoModalGuest.fullName}
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Choisissez l’un des portraits fournis ou importez une nouvelle photo depuis votre appareil.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPhotoModalGuest(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {UPLOADED_PORTRAIT_GALLERY.map((item) => (
                <button
                  key={item.url}
                  type="button"
                  onClick={() => handleAssignPhoto(photoModalGuest, item.url)}
                  className={`group text-left border rounded-xl overflow-hidden transition-colors ${
                    photoModalGuest.photoUrl === item.url
                      ? 'border-emerald-600 ring-2 ring-emerald-600/30'
                      : 'border-slate-300 hover:border-orange-500'
                  }`}
                >
                  <img
                    src={item.url}
                    alt={item.label}
                    referrerPolicy="no-referrer"
                    className="w-full h-32 object-cover object-top"
                  />
                  <div className="p-2 text-xs font-medium text-slate-700 truncate">
                    {item.label}
                  </div>
                </button>
              ))}
            </div>

            <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleUploadPhoto(e, photoModalGuest)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold transition-colors"
              >
                <Upload className="w-4 h-4" />
                Importer une photo locale
              </button>

              {photoModalGuest.photoUrl && (
                <button
                  type="button"
                  onClick={() => handleAssignPhoto(photoModalGuest, '')}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Retirer la photo
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Guest Detail & Notes Modal with Real-Time Debounced Auto-Save (Organizer only) */}
      {isAdmin && selectedGuest && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="detail-modal-title"
        >
          <form
            onSubmit={handleSaveDetail}
            className="bg-white border border-slate-300 rounded-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="detail-modal-title" className="font-display text-lg font-bold text-slate-900">
                  Fiche Invité N° {selectedGuest.orderNumber}
                </h3>
                <p className="text-sm font-medium text-emerald-700 mt-0.5">
                  {selectedGuest.fullName}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseDetailModal}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Real-time auto-save feedback pill inside modal */}
            <div className="bg-[#F4F7FB] border border-slate-200 rounded-xl px-3.5 py-2 flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                {modalAutoSaveState === 'saving' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-orange-600 animate-spin" />
                    Enregistrement automatique sur Firebase...
                  </>
                ) : modalAutoSaveState === 'pending' ? (
                  <>
                    <Clock className="w-3.5 h-3.5 text-orange-600" />
                    Modification détectée (sauvegarde auto...)
                  </>
                ) : modalAutoSaveState === 'saved' && modalSavedTime ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                    Enregistré automatiquement sur Firebase à {modalSavedTime}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                    Sauvegarde automatique Firebase activée sur chaque champ
                  </>
                )}
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nom et Prénoms *
                </label>
                <input
                  type="text"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  maxLength={160}
                  className="w-full h-10 px-3 bg-[#F4F7FB] border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nationalité *
                  </label>
                  <input
                    type="text"
                    required
                    value={editNationality}
                    onChange={(e) => setEditNationality(e.target.value)}
                    maxLength={80}
                    className="w-full h-10 px-3 bg-[#F4F7FB] border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    N° de Passeport
                  </label>
                  <input
                    type="text"
                    value={editPassport}
                    onChange={(e) => setEditPassport(e.target.value)}
                    maxLength={40}
                    placeholder="Ex. 25HC58819"
                    className="w-full h-10 px-3 bg-[#F4F7FB] border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2.5 pt-1">
                <input
                  id="edit-coverage"
                  type="checkbox"
                  checked={editFullCoverage}
                  onChange={(e) => setEditFullCoverage(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600"
                />
                <label htmlFor="edit-coverage" className="text-sm font-medium text-slate-800">
                  Prise en charge complète Bilili
                </label>
              </div>

              {editFullCoverage && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Précision prise en charge
                  </label>
                  <input
                    type="text"
                    value={editCoverageNote}
                    onChange={(e) => setEditCoverageNote(e.target.value)}
                    maxLength={200}
                    placeholder="Prise en charge complète Bilili"
                    className="w-full h-10 px-3 bg-[#F4F7FB] border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
              )}

              {/* Cultural Program (Visible to public too) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Programme culturel / Dédicaces / Ateliers (public)
                </label>
                <input
                  type="text"
                  value={editProgramSchedule}
                  onChange={(e) => setEditProgramSchedule(e.target.value)}
                  maxLength={300}
                  placeholder="Ex. Dédicace Vendredi 15h · Table ronde Samedi 11h"
                  className="w-full h-10 px-3 bg-[#F4F7FB] border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
              </div>

              {/* Private Logistics Section (Admin only) */}
              <div className="bg-[#F4F7FB] border border-slate-200 rounded-xl p-3.5 space-y-3">
                <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Plane className="w-3.5 h-3.5 text-emerald-700" />
                  Logistique d’accueil (confidentiel organisateur)
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Date d’arrivée prévue
                    </label>
                    <input
                      type="date"
                      value={editArrivalDate}
                      onChange={(e) => setEditArrivalDate(e.target.value)}
                      className="w-full h-9 px-2.5 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Vol &amp; heure d’arrivée
                    </label>
                    <input
                      type="text"
                      value={editArrivalFlight}
                      onChange={(e) => setEditArrivalFlight(e.target.value)}
                      maxLength={120}
                      placeholder="Ex. AF884 · 19h40"
                      className="w-full h-9 px-2.5 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Hôtel / Hébergement
                    </label>
                    <input
                      type="text"
                      value={editHotelName}
                      onChange={(e) => setEditHotelName(e.target.value)}
                      maxLength={160}
                      placeholder="Nom de l’hôtel"
                      className="w-full h-9 px-2.5 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Navette / Chauffeur
                    </label>
                    <input
                      type="text"
                      value={editDriverName}
                      onChange={(e) => setEditDriverName(e.target.value)}
                      maxLength={160}
                      placeholder="Nom & téléphone chauffeur"
                      className="w-full h-9 px-2.5 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Notes d’accueil complémentaires
                </label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  maxLength={500}
                  placeholder="Remise de badge, besoins spécifiques..."
                  className="w-full p-3 bg-[#F4F7FB] border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
              </div>

              {/* Connected Appointments Section */}
              <div className="bg-[#F4F7FB] border border-slate-200 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800">
                    Rendez-vous associés
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const nameToBook = editFullName || selectedGuest.fullName;
                      setSelectedGuest(null);
                      onPlanAppointmentForGuest(nameToBook);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 hover:text-orange-900"
                  >
                    <CalendarPlus className="w-3.5 h-3.5" />
                    Planifier un RDV
                  </button>
                </div>

                {(linkedAppointmentsByGuest[selectedGuest.id] || []).length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Aucun rendez-vous enregistré au nom de cet invité pour le moment.
                  </p>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {linkedAppointmentsByGuest[selectedGuest.id].map((appt) => (
                      <li
                        key={appt.id}
                        className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5"
                      >
                        <span className="font-mono font-semibold text-slate-800">
                          {appt.desiredDate} · {appt.desiredTime} ({appt.reason})
                        </span>
                        <span
                          className={`font-semibold ${
                            appt.status === 'confirmed'
                              ? 'text-emerald-700'
                              : appt.status === 'declined_or_reschedule'
                              ? 'text-orange-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {appt.status === 'confirmed'
                            ? 'Confirmé'
                            : appt.status === 'declined_or_reschedule'
                            ? 'À reprogrammer'
                            : 'En attente'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmGuest(selectedGuest)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-xs sm:text-sm font-semibold text-red-700 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Supprimer
                </button>
                <button
                  type="button"
                  disabled={generatingBadges}
                  onClick={() =>
                    void handleExportBadges([selectedGuest], selectedGuest.fullName)
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs sm:text-sm font-semibold text-slate-800 hover:bg-slate-100 transition-colors"
                >
                  <QrCode className="w-4 h-4 text-orange-600" />
                  Badge QR
                </button>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleCloseDetailModal}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Fermer
                </button>
                <button
                  type="submit"
                  disabled={savingId === selectedGuest.id}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
                >
                  {savingId === selectedGuest.id ? 'Enregistrement...' : 'Enregistrer et fermer'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Delete Guest Confirmation Modal (Organizer only) */}
      {isAdmin && deleteConfirmGuest && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-guest-title"
        >
          <div className="bg-white border border-slate-300 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3
                  id="delete-guest-title"
                  className="font-display text-lg font-bold text-slate-900"
                >
                  Supprimer cet invité ?
                </h3>
                <p className="text-xs text-slate-600">
                  Utilisez cette option si la personne ne vient pas au festival.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteConfirmGuest(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-sm text-red-900">
              Confirmez-vous la suppression de{' '}
              <span className="font-bold">{deleteConfirmGuest.fullName}</span> (
              {deleteConfirmGuest.nationality}) ?
            </div>

            <div className="pt-2 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteConfirmGuest(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {deleting ? 'Suppression...' : 'Confirmer la suppression'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Guest Modal (Organizer only) */}
      {isAdmin && addModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-guest-title"
        >
          <form
            onSubmit={handleCreateGuest}
            className="bg-white border border-slate-300 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="add-guest-title" className="font-display text-lg font-bold text-slate-900">
                  Ajouter un invité au recensement
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Enregistrement automatique instantané dans Firebase.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nom et Prénoms *
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={160}
                  placeholder="Ex. M. / Mme ..."
                  className="w-full h-10 px-3 bg-[#F4F7FB] border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nationalité *
                  </label>
                  <input
                    type="text"
                    required
                    value={newNationality}
                    onChange={(e) => setNewNationality(e.target.value)}
                    maxLength={80}
                    placeholder="Ex. Congolaise"
                    className="w-full h-10 px-3 bg-[#F4F7FB] border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    N° de Passeport
                  </label>
                  <input
                    type="text"
                    value={newPassport}
                    onChange={(e) => setNewPassport(e.target.value)}
                    maxLength={40}
                    placeholder="Optionnel"
                    className="w-full h-10 px-3 bg-[#F4F7FB] border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Portrait associé (optionnel)
                </label>
                <select
                  value={newPhotoUrl}
                  onChange={(e) => setNewPhotoUrl(e.target.value)}
                  className="w-full h-10 px-3 bg-[#F4F7FB] border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                >
                  <option value="">Aucune photo pour l’instant</option>
                  {UPLOADED_PORTRAIT_GALLERY.map((p) => (
                    <option key={p.url} value={p.url}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2.5 pt-1">
                <input
                  id="new-coverage"
                  type="checkbox"
                  checked={newFullCoverage}
                  onChange={(e) => setNewFullCoverage(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600"
                />
                <label htmlFor="new-coverage" className="text-sm font-medium text-slate-800">
                  Prise en charge complète Bilili
                </label>
              </div>

              {newFullCoverage && (
                <input
                  type="text"
                  value={newCoverageNote}
                  onChange={(e) => setNewCoverageNote(e.target.value)}
                  maxLength={200}
                  placeholder="Précision (ex. Prise en charge complète Bilili)"
                  className="w-full h-10 px-3 bg-[#F4F7FB] border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Programme culturel / Dédicaces (optionnel)
                </label>
                <input
                  type="text"
                  value={newProgramSchedule}
                  onChange={(e) => setNewProgramSchedule(e.target.value)}
                  maxLength={300}
                  placeholder="Ex. Dédicace Samedi 14h · IFC"
                  className="w-full h-10 px-3 bg-[#F4F7FB] border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Date d’arrivée prévue
                  </label>
                  <input
                    type="date"
                    value={newArrivalDate}
                    onChange={(e) => setNewArrivalDate(e.target.value)}
                    className="w-full h-9 px-2.5 bg-[#F4F7FB] border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Vol / Heure
                  </label>
                  <input
                    type="text"
                    value={newArrivalFlight}
                    onChange={(e) => setNewArrivalFlight(e.target.value)}
                    maxLength={120}
                    placeholder="Ex. AF884 · 19h40"
                    className="w-full h-9 px-2.5 bg-[#F4F7FB] border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Hôtel
                  </label>
                  <input
                    type="text"
                    value={newHotelName}
                    onChange={(e) => setNewHotelName(e.target.value)}
                    maxLength={160}
                    placeholder="Hébergement"
                    className="w-full h-9 px-2.5 bg-[#F4F7FB] border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Navette / Chauffeur
                  </label>
                  <input
                    type="text"
                    value={newDriverName}
                    onChange={(e) => setNewDriverName(e.target.value)}
                    maxLength={160}
                    placeholder="Contact chauffeur"
                    className="w-full h-9 px-2.5 bg-[#F4F7FB] border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={adding}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
              >
                {adding ? 'Enregistrement...' : 'Enregistrer l’invité'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* WhatsApp Share Modal */}
      {shareModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-modal-title"
        >
          <div className="bg-white border border-slate-300 rounded-2xl max-w-lg w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="share-modal-title" className="font-display text-lg font-bold text-slate-900">
                  Partager l’application sur WhatsApp
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Envoyez ce lien à vos contacts WhatsApp. Seul l’organisateur connecté peut modifier les données internes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onSetShareModalOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                Page d’arrivée pour vos contacts
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(
                  [
                    { id: 'all', label: 'Accueil & Invités' },
                    { id: 'booking', label: 'Prendre un RDV' },
                    { id: 'tracking', label: 'Suivi de RDV' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectShareTarget(opt.id)}
                    className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                      shareTarget === opt.id
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                        : 'border-slate-300 bg-[#F4F7FB] text-slate-700 hover:bg-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Lien officiel à partager
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 h-10 px-3 bg-slate-100 border border-slate-300 rounded-lg text-xs font-mono text-slate-700"
                />
                <button
                  type="button"
                  onClick={() => handleCopyShare('link')}
                  className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 shrink-0"
                >
                  {copiedState === 'link' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      Copié
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copier
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Message WhatsApp
              </label>
              <textarea
                rows={4}
                value={shareMessage}
                onChange={(e) => setShareMessage(e.target.value)}
                className="w-full p-3 bg-[#F4F7FB] border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white"
              />
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900 leading-relaxed">
              Protection active : vos contacts WhatsApp peuvent consulter la liste publique (sans numéros de passeport) et soumettre une demande de rendez-vous sauvegardée automatiquement. Seul votre compte Google organisateur peut modifier ou supprimer des données.
            </div>

            <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => handleCopyShare('message')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-300 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                {copiedState === 'message' ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-700" />
                    Message copié
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copier le message
                  </>
                )}
              </button>

              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold transition-colors"
              >
                <Share2 className="w-4 h-4" />
                Envoyer sur WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Check-in Scanner Modal (Organizer only, lazy-loaded) */}
      {isAdmin && scannerOpen && (
        <Suspense fallback={null}>
          <LazyQRScannerModal
            open={scannerOpen}
            guests={guests}
            onClose={() => setScannerOpen(false)}
            onMarkCheckedIn={onToggleCheckIn}
          />
        </Suspense>
      )}
    </div>
  );
};
