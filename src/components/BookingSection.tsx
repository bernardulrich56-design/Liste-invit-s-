import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  Send,
  Share2,
  Users,
  Video,
} from 'lucide-react';
import {
  APPOINTMENT_REASONS,
  DURATION_OPTIONS,
  SHARED_APP_URL,
  WEEKDAYS,
} from '../data/initialData';
import {
  AppointmentFormat,
  AppointmentReason,
  HostConfig,
  HostId,
  PublicAppointmentStatus,
} from '../types';

interface BookingSectionProps {
  hosts: HostConfig[];
  confirmedPublicSlots: PublicAppointmentStatus[];
  initialRequesterName?: string;
  onSubmitRequest: (payload: {
    requesterName: string;
    requesterPhone: string;
    requesterEmail: string;
    hostIds: HostId[];
    isGroupMeeting: boolean;
    reason: AppointmentReason;
    customReason: string;
    desiredDate: string;
    desiredTime: string;
    durationMinutes: number;
    format: AppointmentFormat;
    description: string;
  }) => Promise<{ trackingCode: string }>;
  onGoToTracking: (trackingCode: string) => void;
}

function getWeekdayKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d);
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return keys[dt.getDay()] || '';
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export const BookingSection: React.FC<BookingSectionProps> = ({
  hosts,
  confirmedPublicSlots,
  initialRequesterName = '',
  onSubmitRequest,
  onGoToTracking,
}) => {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [selectionMode, setSelectionMode] = useState<'single' | 'multiple'>('single');
  const [selectedHostIds, setSelectedHostIds] = useState<HostId[]>(['joel']);
  const [requesterName, setRequesterName] = useState(initialRequesterName);

  React.useEffect(() => {
    if (initialRequesterName) {
      setRequesterName(initialRequesterName);
    }
  }, [initialRequesterName]);
  const [requesterPhone, setRequesterPhone] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');
  const [reason, setReason] = useState<AppointmentReason>("Moment d'échange");
  const [customReason, setCustomReason] = useState('');
  const [desiredDate, setDesiredDate] = useState(todayStr);
  const [desiredTime, setDesiredTime] = useState('10:00');
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [format, setFormat] = useState<AppointmentFormat>('présentiel');
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);

  const handleToggleHost = (hostId: HostId) => {
    if (selectionMode === 'single') {
      setSelectedHostIds([hostId]);
      return;
    }
    setSelectedHostIds((prev) =>
      prev.includes(hostId) ? prev.filter((id) => id !== hostId) : [...prev, hostId]
    );
  };

  const handleModeSwitch = (mode: 'single' | 'multiple') => {
    setSelectionMode(mode);
    if (mode === 'single' && selectedHostIds.length !== 1) {
      setSelectedHostIds([selectedHostIds[0] || 'joel']);
    }
  };

  const selectedHosts = useMemo(
    () => hosts.filter((h) => selectedHostIds.includes(h.hostId)),
    [hosts, selectedHostIds]
  );

  // Check schedule & confirmed overlap warnings on chosen date/time
  const slotConflicts = useMemo(() => {
    const warnings: string[] = [];
    if (!desiredDate || !desiredTime || selectedHosts.length === 0) return warnings;

    const weekdayKey = getWeekdayKey(desiredDate);
    const reqStart = timeToMinutes(desiredTime);
    const reqEnd = reqStart + durationMinutes;

    for (const host of selectedHosts) {
      if (host.blockedDates.includes(desiredDate)) {
        warnings.push(`${host.name} est indisponible le ${desiredDate}.`);
      } else if (weekdayKey && !host.workingDays.includes(weekdayKey)) {
        const dayLabel = WEEKDAYS.find((w) => w.key === weekdayKey)?.label || weekdayKey;
        warnings.push(`${host.name} ne reçoit habituellement pas le ${dayLabel}.`);
      }

      const startMin = timeToMinutes(host.startHour);
      const endMin = timeToMinutes(host.endHour);
      if (reqStart < startMin || reqEnd > endMin) {
        warnings.push(
          `L’horaire demandé sort de la plage habituelle de ${host.name} (${host.startHour} – ${host.endHour}).`
        );
      }
    }

    const overlappingConfirmed = confirmedPublicSlots.filter((slot) => {
      if (slot.desiredDate !== desiredDate) return false;
      const sharesHost = slot.hostIds.some((id) => selectedHostIds.includes(id));
      if (!sharesHost) return false;
      const sStart = timeToMinutes(slot.desiredTime);
      const sEnd = sStart + slot.durationMinutes;
      return reqStart < sEnd && reqEnd > sStart;
    });

    if (overlappingConfirmed.length > 0) {
      warnings.push(
        `Un rendez-vous confirmé existe déjà sur ce créneau (${overlappingConfirmed[0].desiredTime}). L’administration pourra vous proposer un créneau alternatif.`
      );
    }

    return warnings;
  }, [desiredDate, desiredTime, durationMinutes, selectedHosts, selectedHostIds, confirmedPublicSlots]);

  const occupiedSlotsOnDate = useMemo(() => {
    return confirmedPublicSlots.filter(
      (slot) =>
        slot.desiredDate === desiredDate &&
        slot.hostIds.some((id) => selectedHostIds.includes(id))
    );
  }, [confirmedPublicSlots, desiredDate, selectedHostIds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (selectedHostIds.length === 0) {
      setErrorMsg('Veuillez sélectionner au moins une personne à rencontrer.');
      return;
    }
    if (requesterName.trim().length < 2) {
      setErrorMsg('Veuillez renseigner votre nom et prénom.');
      return;
    }
    if (requesterPhone.trim().length < 5) {
      setErrorMsg('Veuillez renseigner un numéro de téléphone valide.');
      return;
    }
    if (reason === 'Autre' && !customReason.trim()) {
      setErrorMsg('Veuillez préciser le motif de votre rendez-vous.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await onSubmitRequest({
        requesterName: requesterName.trim(),
        requesterPhone: requesterPhone.trim(),
        requesterEmail: requesterEmail.trim(),
        hostIds: selectedHostIds,
        isGroupMeeting: selectedHostIds.length > 1,
        reason,
        customReason: reason === 'Autre' ? customReason.trim() : '',
        desiredDate,
        desiredTime,
        durationMinutes,
        format,
        description: description.trim(),
      });
      setSubmittedCode(result.trackingCode);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Une erreur est survenue lors de l’envoi de votre demande.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSubmittedCode(null);
    setRequesterName('');
    setRequesterPhone('');
    setRequesterEmail('');
    setCustomReason('');
    setDescription('');
  };

  if (submittedCode) {
    return (
      <section className="max-w-3xl mx-auto bg-white border border-slate-300 rounded-xl p-6 sm:p-10 space-y-6">
        <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
          <CheckCircle2 className="w-7 h-7" />
        </div>

        <div className="space-y-3">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 text-balance">
            Demande de rendez-vous enregistrée
          </h1>
          <p className="text-base text-slate-800 leading-relaxed bg-emerald-50 border border-emerald-200 rounded-lg p-4 font-medium">
            « Votre demande de rendez-vous a bien été enregistrée. Elle est actuellement en attente de validation. Vous recevrez une notification dès qu’une décision sera prise. »
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-5 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Code de suivi personnel
          </div>
          <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {submittedCode}
          </div>
          <p className="text-xs text-slate-600">
            Conservez ce code pour suivre l’avancement de votre validation et consulter les notifications dans l’onglet « Suivi & Notifications ».
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => onGoToTracking(submittedCode)}
            className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
          >
            Suivre ma demande
          </button>
          <button
            type="button"
            onClick={resetForm}
            className="px-5 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm font-semibold transition-colors"
          >
            Soumettre une autre demande
          </button>
        </div>
      </section>
    );
  }

  const bookingWhatsAppHref = `https://wa.me/?text=${encodeURIComponent(
    `Bonjour ! Prenez rendez-vous avec Monsieur Jean-Jacques, Vénicia ou Madame Joël (Bilili BD Festival 2026) ici :\n${SHARED_APP_URL}?tab=booking`
  )}`;

  return (
    <div className="space-y-6">
      {/* Intro Header */}
      <section className="bg-white border border-slate-300/90 rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-xs">
        <div className="max-w-3xl space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-orange-700">
            Secrétariat Numérique · Bilili BD Festival 2026
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 text-balance">
            Réserver un moment d’échange ou prendre un rendez-vous
          </h1>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            Soumettez une demande de rendez-vous avec Monsieur Jean-Jacques, Vénicia ou Madame Joël (la fondatrice). Chaque inscription est sauvegardée automatiquement sur Firebase et examinée avant validation dans Google Agenda.
          </p>
        </div>

        <a
          href={bookingWhatsAppHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-600 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs sm:text-sm font-semibold transition-colors shrink-0 self-start md:self-center whitespace-nowrap"
        >
          <Share2 className="w-4 h-4 text-emerald-700" />
          Partager ce formulaire sur WhatsApp
        </a>
      </section>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left column: Step 1 (Host selection) + Step 2 (Details) */}
        <div className="lg:col-span-8 space-y-6">
          {/* Host Selection Card */}
          <section className="bg-white border border-slate-300/90 rounded-2xl p-6 space-y-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  01. Qui souhaitez-vous rencontrer ?
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Choisissez une personne ou sélectionnez plusieurs interlocuteurs simultanément.
                </p>
              </div>

              <div className="inline-flex items-center p-1 bg-[#F4F7FB] border border-slate-200 rounded-xl shrink-0">
                <button
                  type="button"
                  onClick={() => handleModeSwitch('single')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    selectionMode === 'single'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Une personne
                </button>
                <button
                  type="button"
                  onClick={() => handleModeSwitch('multiple')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    selectionMode === 'multiple'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  Plusieurs personnes
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {hosts.map((host) => {
                const isSelected = selectedHostIds.includes(host.hostId);
                const hostInitial =
                  host.hostId === 'jean-jacques'
                    ? 'JJ'
                    : host.hostId === 'venicia'
                    ? 'VE'
                    : 'MJ';
                return (
                  <button
                    key={host.hostId}
                    type="button"
                    onClick={() => handleToggleHost(host.hostId)}
                    className={`text-left p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/75 ring-2 ring-emerald-600/20 shadow-xs'
                        : 'border-slate-300 bg-[#F4F7FB] hover:border-slate-400 hover:bg-white'
                    }`}
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className={`w-10 h-10 rounded-xl font-display font-bold text-sm flex items-center justify-center shrink-0 ${
                            isSelected
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-900 text-white'
                          }`}
                        >
                          {hostInitial}
                        </div>
                        <span
                          className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                            isSelected
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'border-slate-400 bg-white'
                          }`}
                        >
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                        </span>
                      </div>
                      <div>
                        <div className="font-display text-base font-bold text-slate-900">
                          {host.name}
                        </div>
                        <p className="text-xs font-medium text-slate-600 mt-0.5">{host.role}</p>
                      </div>
                    </div>

                    <div className="pt-2.5 border-t border-slate-200/80 text-xs text-slate-600 space-y-0.5">
                      <div className="tabular-nums font-medium text-slate-700">
                        Horaires : {host.startHour} – {host.endHour}
                      </div>
                      <div>
                        {host.workingDays
                          .map((k) => WEEKDAYS.find((w) => w.key === k)?.label || k)
                          .join(' · ')}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Request Details Card */}
          <section className="bg-white border border-slate-300/90 rounded-2xl p-6 space-y-5 shadow-xs">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                02. Vos coordonnées & motif de l’échange
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Ces informations permettent à la personne concernée de préparer l’échange et de confirmer votre créneau.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Nom et prénom *
                </label>
                <input
                  type="text"
                  required
                  value={requesterName}
                  onChange={(e) => setRequesterName(e.target.value)}
                  maxLength={120}
                  placeholder="Ex. Jean-Paul Makosso"
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Numéro de téléphone *
                </label>
                <input
                  type="tel"
                  required
                  value={requesterPhone}
                  onChange={(e) => setRequesterPhone(e.target.value)}
                  maxLength={40}
                  placeholder="Ex. +242 06 000 00 00"
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Adresse e-mail (facultative)
                </label>
                <input
                  type="email"
                  value={requesterEmail}
                  onChange={(e) => setRequesterEmail(e.target.value)}
                  maxLength={120}
                  placeholder="Pour recevoir l’invitation Google Agenda"
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Motif du rendez-vous *
                </label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value as AppointmentReason)}
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                >
                  {APPOINTMENT_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {reason === 'Autre' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Précisez votre motif *
                </label>
                <input
                  type="text"
                  required
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  maxLength={200}
                  placeholder="Précisez l’objet de votre demande..."
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Format du rendez-vous *
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setFormat('présentiel')}
                  className={`h-11 px-4 rounded-lg border text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
                    format === 'présentiel'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                      : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-white'
                  }`}
                >
                  <MapPin className="w-4 h-4" />
                  Présentiel
                </button>
                <button
                  type="button"
                  onClick={() => setFormat('en ligne')}
                  className={`h-11 px-4 rounded-lg border text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
                    format === 'en ligne'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                      : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-white'
                  }`}
                >
                  <Video className="w-4 h-4" />
                  En ligne
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Commentaire ou description de la demande
              </label>
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                placeholder="Décrivez brièvement le sujet à aborder, vos objectifs ou contraintes éventuelles..."
                className="w-full p-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
              />
            </div>
          </section>
        </div>

        {/* Right column: Date, Time, Duration & Submit */}
        <div className="lg:col-span-4 space-y-6">
          <section className="bg-white border border-slate-300/90 rounded-2xl p-6 space-y-5 shadow-xs">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                03. Créneau souhaité
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Ce créneau restera en attente de validation par la ou les personnes concernées.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Date souhaitée *
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="date"
                    required
                    min={todayStr}
                    value={desiredDate}
                    onChange={(e) => setDesiredDate(e.target.value)}
                    className="w-full h-11 pl-10 pr-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono tabular-nums focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Heure souhaitée *
                  </label>
                  <div className="relative">
                    <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="time"
                      required
                      value={desiredTime}
                      onChange={(e) => setDesiredTime(e.target.value)}
                      className="w-full h-11 pl-9 pr-2 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono tabular-nums focus:outline-none focus:border-emerald-600 focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Durée estimée *
                  </label>
                  <select
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="w-full h-11 px-3 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                  >
                    {DURATION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Occupied slots preview for the selected date */}
            {occupiedSlotsOnDate.length > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2">
                <p className="text-xs font-semibold text-slate-700">
                  Créneaux déjà confirmés le {desiredDate} :
                </p>
                <ul className="space-y-1 text-xs text-slate-600 font-mono tabular-nums">
                  {occupiedSlotsOnDate.map((slot) => (
                    <li key={slot.trackingCode}>
                      • {slot.desiredTime} ({slot.durationMinutes} min)
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Schedule warnings */}
            {slotConflicts.length > 0 && (
              <div className="bg-orange-50 border border-orange-300 rounded-lg p-3.5 space-y-1.5 text-xs text-orange-900">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0 text-orange-700" />
                  Alerte de disponibilité
                </div>
                {slotConflicts.map((warn, idx) => (
                  <p key={idx} className="leading-relaxed">
                    {warn}
                  </p>
                ))}
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="bg-red-50 border border-red-300 text-red-800 rounded-lg p-3 text-xs font-medium"
              >
                {errorMsg}
              </div>
            )}

            {/* Summary */}
            <div className="pt-3 border-t border-slate-200 space-y-2 text-xs text-slate-600">
              <div className="flex justify-between gap-2">
                <span>Participant(s)</span>
                <span className="font-semibold text-slate-900 text-right">
                  {selectedHosts.map((h) => h.name).join(', ') || 'Aucun'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Statut initial</span>
                <span className="font-semibold text-orange-700">En attente de validation</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-11 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              <Send className="w-4 h-4" />
              {submitting ? 'Enregistrement en cours...' : 'Soumettre la demande'}
            </button>

            <p className="text-xs text-slate-500 text-center leading-relaxed">
              Sauvegarde automatique active : votre inscription et votre code de suivi sont enregistrés immédiatement dans la base de données.
            </p>
          </section>
        </div>
      </form>
    </div>
  );
};
