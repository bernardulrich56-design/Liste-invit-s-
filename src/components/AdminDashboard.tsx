import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Calendar,
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Filter,
  History,
  LayoutGrid,
  Lock,
  LogOut,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  UserCheck,
  Video,
  X,
} from 'lucide-react';
import { WEEKDAYS } from '../data/initialData';
import { downloadAppointmentICS } from '../services/icsExport';
import { normalizePersonName } from './GuestRegistry';
import { HostVisualSchedule } from './HostVisualSchedule';
import {
  buildDateTimeRange,
  checkCalendarFreeBusy,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  fetchGoogleCalendarList,
  GoogleCalendarSummary,
  updateGoogleCalendarEvent,
} from '../services/googleCalendar';
import {
  connectHostGoogleAccount,
  getAdminAccessToken,
  getHostAccessToken,
  getHostConnectedSessionEmail,
} from '../services/firebase';
import {
  AdminUserRecord,
  AppNotification,
  Appointment,
  AppointmentStatus,
  CalendarEventRef,
  Guest,
  HostConfig,
  HostId,
} from '../types';
import { GoogleSignInButton } from './GoogleSignInButton';

interface AdminDashboardProps {
  currentUserEmail: string | null;
  currentUserUid: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isSigningIn: boolean;
  authError?: string | null;
  onClearAuthError?: () => void;
  onAdminSignIn: () => void;
  onSignOut: () => void;
  guests: Guest[];
  hosts: HostConfig[];
  appointments: Appointment[];
  notifications: AppNotification[];
  adminUsers: AdminUserRecord[];
  initialSubTab?: 'demandes' | 'planning' | 'calendars' | 'notifications' | 'team';
  onSaveHostConfig: (host: HostConfig) => Promise<void>;
  onUpdateAppointmentStatus: (
    appointment: Appointment,
    updates: {
      status: AppointmentStatus;
      desiredDate?: string;
      desiredTime?: string;
      durationMinutes?: number;
      proposedDate: string;
      proposedTime: string;
      adminComment: string;
      calendarEvents: CalendarEventRef[];
    },
    requesterNotification: {
      title: string;
      message: string;
      type: AppNotification['type'];
    }
  ) => Promise<void>;
  onMarkNotificationRead: (notifId: string) => Promise<void>;
  onAddAdminUser: (record: AdminUserRecord) => Promise<void>;
  onDeleteAdminUser: (uid: string) => Promise<void>;
}

type AdminView = 'demandes' | 'planning' | 'calendars' | 'notifications' | 'team';

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUserEmail,
  currentUserUid,
  isAdmin,
  isSuperAdmin,
  isSigningIn,
  authError = null,
  onClearAuthError,
  onAdminSignIn,
  onSignOut,
  guests,
  hosts,
  appointments,
  notifications,
  adminUsers,
  initialSubTab = 'demandes',
  onSaveHostConfig,
  onUpdateAppointmentStatus,
  onMarkNotificationRead,
  onAddAdminUser,
  onDeleteAdminUser,
}) => {
  const [subTab, setSubTab] = useState<AdminView>(initialSubTab);
  const hostAutoSaveTimers = React.useRef<Record<string, number>>({});

  React.useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  React.useEffect(() => {
    const timers = hostAutoSaveTimers.current;
    return () => {
      Object.values(timers).forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  // Filters for demandes
  const [filterHost, setFilterHost] = useState<'all' | HostId>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | AppointmentStatus>('all');
  const [filterDate, setFilterDate] = useState('');

  // Action feedback & processing state
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Reschedule / Refuse modal
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [proposedDate, setProposedDate] = useState('');
  const [proposedTime, setProposedTime] = useState('');
  const [adminComment, setAdminComment] = useState('');

  // Mandatory confirmation dialog for modifying/deleting Google Calendar events
  const [confirmCalendarMutation, setConfirmCalendarMutation] = useState<{
    mode: 'update' | 'cancel';
    appointment: Appointment;
    newDate: string;
    newTime: string;
    newDuration: number;
    comment: string;
  } | null>(null);

  // Per-host calendar connection state
  const [connectingHost, setConnectingHost] = useState<HostId | null>(null);
  const [hostCalendarLists, setHostCalendarLists] = useState<
    Partial<Record<HostId, GoogleCalendarSummary[]>>
  >({});
  const [hostDrafts, setHostDrafts] = useState<Record<string, HostConfig>>({});
  const [newBlockedDate, setNewBlockedDate] = useState<Record<string, string>>({});
  const [savingHostId, setSavingHostId] = useState<string | null>(null);

  // Add admin form (Super Admin)
  const [newAdminUid, setNewAdminUid] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminHostId, setNewAdminHostId] = useState<'all' | HostId>('all');

  const unreadAdminNotifs = useMemo(
    () => notifications.filter((n) => n.recipientRole === 'admin' && !n.read).length,
    [notifications]
  );

  const appointmentStats = useMemo(() => {
    const pending = appointments.filter((a) => a.status === 'pending').length;
    const confirmed = appointments.filter((a) => a.status === 'confirmed').length;
    const declined = appointments.filter((a) => a.status === 'declined_or_reschedule').length;
    return { pending, confirmed, declined, total: appointments.length };
  }, [appointments]);

  const [briefingCopied, setBriefingCopied] = useState(false);

  const filteredAppointments = useMemo(() => {
    return appointments.filter((appt) => {
      if (filterHost !== 'all' && !appt.hostIds.includes(filterHost)) return false;
      if (filterStatus !== 'all' && appt.status !== filterStatus) return false;
      if (filterDate && appt.desiredDate !== filterDate) return false;
      return true;
    });
  }, [appointments, filterHost, filterStatus, filterDate]);

  const dailyBriefingText = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayConfirmed = appointments
      .filter((a) => a.status === 'confirmed' && a.desiredDate === todayStr)
      .sort((a, b) => a.desiredTime.localeCompare(b.desiredTime));

    const targetList =
      todayConfirmed.length > 0
        ? todayConfirmed
        : appointments
            .filter((a) => a.status === 'confirmed' && a.desiredDate >= todayStr)
            .sort((a, b) =>
              `${a.desiredDate} ${a.desiredTime}`.localeCompare(
                `${b.desiredDate} ${b.desiredTime}`
              )
            )
            .slice(0, 8);

    const receivedCount = guests.filter((g) => g.checkedIn).length;
    const header =
      todayConfirmed.length > 0
        ? `*Briefing Bilili BD 2026 — Aujourd’hui (${todayStr})*`
        : `*Briefing Bilili BD 2026 — Prochains RDV confirmés*`;

    const lines = [
      header,
      `Accueil invités : ${receivedCount}/${guests.length} reçu(s) · RDV en attente : ${appointmentStats.pending}`,
      '',
    ];

    if (targetList.length === 0) {
      lines.push('Aucun rendez-vous confirmé à venir pour le moment.');
    } else {
      targetList.forEach((a) => {
        const hNames = a.hostIds
          .map((id) => hosts.find((h) => h.hostId === id)?.name || id)
          .join(', ');
        lines.push(
          `• ${a.desiredDate} à ${a.desiredTime} (${a.durationMinutes} min) — ${a.requesterName} avec ${hNames} [${a.format}]`
        );
      });
    }
    return lines.join('\n');
  }, [appointments, guests, hosts, appointmentStats.pending]);

  // If not signed in or not authorized admin -> show secure gate
  if (!currentUserUid || !isAdmin) {
    return (
      <div className="max-w-xl mx-auto bg-white border border-slate-300 rounded-2xl p-6 sm:p-8 text-center space-y-6 shadow-xs">
        <div className="w-14 h-14 mx-auto rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center">
          <Lock className="w-7 h-7" />
        </div>

        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Espace Organisateur Sécurisé
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Cet espace est réservé à l’organisateur et à la direction (Monsieur Jean-Jacques, Vénicia, Madame Joël) pour gérer les invités, valider les rendez-vous et synchroniser Google Agenda.
          </p>
        </div>

        {authError && (
          <div
            role="alert"
            className="bg-red-50 border border-red-300 rounded-xl p-4 text-left text-xs sm:text-sm text-red-900 space-y-2"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{authError}</span>
            </div>
            {onClearAuthError && (
              <button
                type="button"
                onClick={onClearAuthError}
                className="text-xs font-semibold text-red-800 underline underline-offset-2"
              >
                Fermer ce message
              </button>
            )}
          </div>
        )}

        {currentUserUid && !isAdmin ? (
          <div className="bg-orange-50 border border-orange-300 rounded-xl p-4 text-sm text-orange-900 space-y-3">
            <p className="font-medium">
              Le compte <span className="font-mono font-semibold">{currentUserEmail}</span> n’est pas autorisé à accéder à l’espace Organisateur.
            </p>
            <button
              type="button"
              onClick={onSignOut}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
            >
              Changer de compte Google
            </button>
          </div>
        ) : (
          <div className="pt-2 flex justify-center">
            <GoogleSignInButton
              label="Se connecter avec Google (Organisateur)"
              onClick={onAdminSignIn}
              loading={isSigningIn}
            />
          </div>
        )}
      </div>
    );
  }

  const getHostName = (id: HostId) =>
    hosts.find((h) => h.hostId === id)?.name || id;

  const getDraftHost = (host: HostConfig): HostConfig =>
    hostDrafts[host.hostId] || host;

  const findMatchingGuest = (requesterName: string): Guest | undefined => {
    const reqNorm = normalizePersonName(requesterName);
    if (!reqNorm) return undefined;
    return guests.find((g) => {
      const gNorm = normalizePersonName(g.fullName);
      if (!gNorm) return false;
      if (reqNorm.includes(gNorm) || gNorm.includes(reqNorm)) return true;
      const tokens = gNorm.split(' ').filter((t) => t.length >= 3);
      return tokens.length >= 2 && tokens.filter((t) => reqNorm.includes(t)).length >= 2;
    });
  };

  const buildRequesterWhatsAppHref = (appt: Appointment): string | null => {
    const digits = appt.requesterPhone.replace(/[^\d]/g, '');
    if (digits.length < 6) return null;
    const hostList = appt.hostIds.map(getHostName).join(', ');
    const text =
      appt.status === 'confirmed'
        ? `Bonjour ${appt.requesterName}, votre rendez-vous Bilili BD Festival 2026 (${appt.trackingCode}) avec ${hostList} est CONFIRMÉ pour le ${appt.desiredDate} à ${appt.desiredTime} (${appt.format}).`
        : appt.status === 'declined_or_reschedule' && appt.proposedDate
        ? `Bonjour ${appt.requesterName}, concernant votre demande ${appt.trackingCode} avec ${hostList}, nous vous proposons un nouveau créneau le ${appt.proposedDate} à ${appt.proposedTime}.`
        : `Bonjour ${appt.requesterName}, nous avons bien reçu votre demande de rendez-vous ${appt.trackingCode} avec ${hostList} pour le ${appt.desiredDate} à ${appt.desiredTime}.`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  };

  const updateDraftHost = (
    host: HostConfig,
    partial: Partial<HostConfig>,
    autoSave = true
  ) => {
    const nextConfig: HostConfig = {
      ...(hostDrafts[host.hostId] || host),
      ...partial,
    };
    setHostDrafts((prev) => ({
      ...prev,
      [host.hostId]: nextConfig,
    }));

    if (!autoSave) return;
    if (hostAutoSaveTimers.current[host.hostId]) {
      window.clearTimeout(hostAutoSaveTimers.current[host.hostId]);
    }
    hostAutoSaveTimers.current[host.hostId] = window.setTimeout(async () => {
      const timeOk =
        /^[0-2][0-9]:[0-5][0-9]$/.test(nextConfig.startHour) &&
        /^[0-2][0-9]:[0-5][0-9]$/.test(nextConfig.endHour);
      if (!timeOk) return;
      setSavingHostId(host.hostId);
      try {
        await onSaveHostConfig(nextConfig);
        setActionSuccess(`Configuration enregistrée automatiquement pour ${host.name}.`);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : 'Erreur lors de la sauvegarde automatique.'
        );
      } finally {
        setSavingHostId(null);
      }
    }, 750);
  };

  // Validate & confirm appointment with double-booking prevention + Google Calendar event creation
  const handleConfirmAndSync = async (appt: Appointment) => {
    setActionError(null);
    setActionSuccess(null);
    setProcessingId(appt.id);

    try {
      // 1. Check internal Firestore confirmed appointments for conflicts
      const reqStart = timeToMinutes(appt.desiredTime);
      const reqEnd = reqStart + appt.durationMinutes;

      for (const targetHostId of appt.hostIds) {
        const host = hosts.find((h) => h.hostId === targetHostId);
        if (host?.blockedDates.includes(appt.desiredDate)) {
          throw new Error(
            `Conflit de disponibilité : ${host.name} a bloqué la date du ${appt.desiredDate}. Veuillez proposer un autre créneau.`
          );
        }

        const internalConflict = appointments.find((other) => {
          if (other.id === appt.id || other.status !== 'confirmed') return false;
          if (other.desiredDate !== appt.desiredDate) return false;
          if (!other.hostIds.includes(targetHostId)) return false;
          const oStart = timeToMinutes(other.desiredTime);
          const oEnd = oStart + other.durationMinutes;
          return reqStart < oEnd && reqEnd > oStart;
        });

        if (internalConflict) {
          throw new Error(
            `Double réservation détectée : ${getHostName(targetHostId)} a déjà un rendez-vous confirmé le ${appt.desiredDate} à ${internalConflict.desiredTime} (${internalConflict.requesterName}).`
          );
        }
      }

      // 2. Check Google Calendar FreeBusy API for every connected host
      const { startISO, endISO } = buildDateTimeRange(
        appt.desiredDate,
        appt.desiredTime,
        appt.durationMinutes
      );

      const hostTokenMap: Partial<Record<HostId, string>> = {};
      for (const targetHostId of appt.hostIds) {
        const specificToken = getHostAccessToken(targetHostId);
        const fallbackToken = getAdminAccessToken();
        const host = hosts.find((h) => h.hostId === targetHostId);

        // Use host's specific OAuth token, OR admin token if the host shares the admin's Google account or a shared calendar ID
        const tokenToUse =
          specificToken ||
          (host?.googleConnectedEmail === currentUserEmail ||
          (host?.googleCalendarId && host.googleCalendarId !== 'primary')
            ? fallbackToken
            : null);

        if (tokenToUse) {
          hostTokenMap[targetHostId] = tokenToUse;
          const calendarId = host?.googleCalendarId || 'primary';
          const busySlots = await checkCalendarFreeBusy(
            tokenToUse,
            calendarId,
            startISO,
            endISO
          );
          if (busySlots.length > 0) {
            const busyStart = new Date(busySlots[0].start).toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            });
            const busyEnd = new Date(busySlots[0].end).toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            });
            throw new Error(
              `Conflit détecté sur Google Agenda de ${getHostName(targetHostId)} entre ${busyStart} et ${busyEnd}. Veuillez proposer un autre créneau.`
            );
          }
        }
      }

      // 3. Create Google Calendar events for all connected target hosts
      const newCalendarEvents: CalendarEventRef[] = [...(appt.calendarEvents || [])];
      const syncedHosts: string[] = [];
      const unsyncedHosts: string[] = [];

      const reasonLabel =
        appt.reason === 'Autre' && appt.customReason
          ? `Autre : ${appt.customReason}`
          : appt.reason;

      const attendeeEmails = [
        appt.requesterEmail,
        ...appt.hostIds
          .map((id) => {
            const h = hosts.find((item) => item.hostId === id);
            return h?.googleConnectedEmail || h?.email || '';
          })
          .filter(Boolean),
      ].filter(Boolean);

      for (const targetHostId of appt.hostIds) {
        const alreadySynced = newCalendarEvents.find((e) => e.hostId === targetHostId);
        if (alreadySynced) {
          syncedHosts.push(getHostName(targetHostId));
          continue;
        }
        const token = hostTokenMap[targetHostId];
        const host = hosts.find((h) => h.hostId === targetHostId);
        if (!token) {
          unsyncedHosts.push(getHostName(targetHostId));
          continue;
        }

        const calendarId = host?.googleCalendarId || 'primary';
        const created = await createGoogleCalendarEvent(token, calendarId, {
          summary: `[Bilili RDV] ${reasonLabel} — ${appt.requesterName}`,
          description: [
            `Code de suivi : ${appt.trackingCode}`,
            `Demandeur : ${appt.requesterName}`,
            `Téléphone : ${appt.requesterPhone}`,
            appt.requesterEmail ? `E-mail : ${appt.requesterEmail}` : '',
            `Motif : ${reasonLabel}`,
            `Format : ${appt.format}`,
            `Durée : ${appt.durationMinutes} minutes`,
            `Participant(s) : ${appt.hostIds.map(getHostName).join(', ')}`,
            appt.description ? `\nDescription :\n${appt.description}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          location:
            appt.format === 'présentiel'
              ? 'Institut français du Congo — Bilili BD Festival'
              : 'En ligne (Visioconférence)',
          startISO,
          endISO,
          attendeeEmails,
        });

        newCalendarEvents.push({
          hostId: targetHostId,
          hostName: getHostName(targetHostId),
          calendarId,
          eventId: created.eventId,
          htmlLink: created.htmlLink,
        });
        syncedHosts.push(getHostName(targetHostId));
      }

      // 4. Persist confirmation in Firestore + notify requester
      await onUpdateAppointmentStatus(
        appt,
        {
          status: 'confirmed',
          proposedDate: '',
          proposedTime: '',
          adminComment:
            unsyncedHosts.length > 0
              ? `Rendez-vous confirmé. Agenda(s) synchronisé(s) : ${syncedHosts.join(', ') || 'aucun'}. En attente de connexion Google Agenda pour : ${unsyncedHosts.join(', ')}.`
              : `Rendez-vous confirmé et synchronisé dans Google Agenda (${syncedHosts.join(', ')}).`,
          calendarEvents: newCalendarEvents,
        },
        {
          title: `Rendez-vous confirmé (${appt.trackingCode})`,
          message: `Votre rendez-vous avec ${appt.hostIds.map(getHostName).join(', ')} le ${appt.desiredDate} à ${appt.desiredTime} (${appt.durationMinutes} min, ${appt.format}) a été confirmé.`,
          type: 'confirmed',
        }
      );

      if (unsyncedHosts.length > 0) {
        setActionSuccess(
          `Rendez-vous confirmé. Attention : connectez le compte Google de ${unsyncedHosts.join(', ')} dans « Agendas Google & Disponibilités » puis cliquez sur « Synchroniser Agenda » pour finaliser l'ajout à leur agenda.`
        );
      } else {
        setActionSuccess(
          `Rendez-vous confirmé et inscrit dans Google Agenda pour ${syncedHosts.join(', ')}.`
        );
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Erreur lors de la validation du rendez-vous.'
      );
    } finally {
      setProcessingId(null);
    }
  };

  // Propose another slot or decline
  const handleSubmitReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rescheduleTarget) return;
    setActionError(null);
    setActionSuccess(null);
    setProcessingId(rescheduleTarget.id);

    try {
      const hasProposal = Boolean(proposedDate && proposedTime);
      await onUpdateAppointmentStatus(
        rescheduleTarget,
        {
          status: 'declined_or_reschedule',
          proposedDate,
          proposedTime,
          adminComment:
            adminComment.trim() ||
            (hasProposal
              ? `Un autre créneau vous est proposé : ${proposedDate} à ${proposedTime}.`
              : 'Ce créneau n’est malheureusement pas disponible.'),
          calendarEvents: rescheduleTarget.calendarEvents || [],
        },
        {
          title: hasProposal
            ? `Nouveau créneau proposé (${rescheduleTarget.trackingCode})`
            : `Demande non retenue / à reprogrammer (${rescheduleTarget.trackingCode})`,
          message: hasProposal
            ? `Un autre créneau vous est proposé le ${proposedDate} à ${proposedTime}. ${adminComment.trim()}`
            : `Votre demande pour le ${rescheduleTarget.desiredDate} à ${rescheduleTarget.desiredTime} nécessite une reprogrammation. ${adminComment.trim()}`,
          type: hasProposal ? 'rescheduled' : 'declined',
        }
      );

      setRescheduleTarget(null);
      setProposedDate('');
      setProposedTime('');
      setAdminComment('');
      setActionSuccess('Réponse enregistrée et notification envoyée au demandeur.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erreur lors de la mise à jour.');
    } finally {
      setProcessingId(null);
    }
  };

  // Confirmed modal execution: Modify or Cancel Google Calendar events + Firestore
  const handleExecuteCalendarMutation = async () => {
    if (!confirmCalendarMutation) return;
    const { mode, appointment, newDate, newTime, newDuration, comment } =
      confirmCalendarMutation;
    setActionError(null);
    setActionSuccess(null);
    setProcessingId(appointment.id);

    try {
      const existingEvents = appointment.calendarEvents || [];
      if (mode === 'cancel') {
        for (const evt of existingEvents) {
          const token = getHostAccessToken(evt.hostId) || getAdminAccessToken();
          if (token) {
            await deleteGoogleCalendarEvent(token, evt.calendarId, evt.eventId);
          }
        }
        await onUpdateAppointmentStatus(
          appointment,
          {
            status: 'declined_or_reschedule',
            proposedDate: '',
            proposedTime: '',
            adminComment: comment || 'Rendez-vous annulé par l’administration.',
            calendarEvents: [],
          },
          {
            title: `Rendez-vous annulé (${appointment.trackingCode})`,
            message: `Le rendez-vous prévu le ${appointment.desiredDate} à ${appointment.desiredTime} a été annulé. ${comment}`,
            type: 'declined',
          }
        );
        setActionSuccess('Rendez-vous annulé et retiré de Google Agenda.');
      } else {
        const { startISO, endISO } = buildDateTimeRange(newDate, newTime, newDuration);
        for (const evt of existingEvents) {
          const token = getHostAccessToken(evt.hostId) || getAdminAccessToken();
          if (token) {
            await updateGoogleCalendarEvent(token, evt.calendarId, evt.eventId, {
              startISO,
              endISO,
              description: `Horaire mis à jour (${newDate} à ${newTime}, ${newDuration} min). ${comment}`,
            });
          }
        }
        await onUpdateAppointmentStatus(
          appointment,
          {
            status: 'confirmed',
            desiredDate: newDate,
            desiredTime: newTime,
            durationMinutes: newDuration,
            proposedDate: '',
            proposedTime: '',
            adminComment: comment || `Horaire mis à jour : ${newDate} à ${newTime}.`,
            calendarEvents: existingEvents,
          },
          {
            title: `Horaire modifié (${appointment.trackingCode})`,
            message: `Votre rendez-vous confirmé a été déplacé au ${newDate} à ${newTime} (${newDuration} min).`,
            type: 'calendar_sync',
          }
        );
        setActionSuccess('Rendez-vous modifié et mis à jour dans Google Agenda.');
      }
      setConfirmCalendarMutation(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Erreur lors de la synchronisation Google Agenda.'
      );
    } finally {
      setProcessingId(null);
    }
  };

  // Connect a specific host's Google account
  const handleConnectHostGoogle = async (host: HostConfig) => {
    setActionError(null);
    setActionSuccess(null);
    setConnectingHost(host.hostId);
    try {
      const { email, accessToken } = await connectHostGoogleAccount(host.hostId);
      const calendars = await fetchGoogleCalendarList(accessToken);
      setHostCalendarLists((prev) => ({ ...prev, [host.hostId]: calendars }));
      const primaryCal = calendars.find((c) => c.primary)?.id || 'primary';
      const updated: HostConfig = {
        ...getDraftHost(host),
        googleConnected: true,
        googleConnectedEmail: email,
        email: getDraftHost(host).email || email,
        googleCalendarId: getDraftHost(host).googleCalendarId || primaryCal,
      };
      await onSaveHostConfig(updated);
      setActionSuccess(
        `Compte Google (${email}) connecté pour ${host.name}. Choisissez l’agenda cible et enregistrez si besoin.`
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Impossible de connecter le compte Google.'
      );
    } finally {
      setConnectingHost(null);
    }
  };

  const handleSaveHost = async (host: HostConfig) => {
    setActionError(null);
    setActionSuccess(null);
    setSavingHostId(host.hostId);
    try {
      await onSaveHostConfig(getDraftHost(host));
      setHostDrafts((prev) => {
        const next = { ...prev };
        delete next[host.hostId];
        return next;
      });
      setActionSuccess(`Disponibilités et agenda enregistrés pour ${host.name}.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erreur lors de l’enregistrement.');
    } finally {
      setSavingHostId(null);
    }
  };

  const handleToggleWeekday = async (host: HostConfig, dayKey: string) => {
    const draft = getDraftHost(host);
    const nextDays = draft.workingDays.includes(dayKey)
      ? draft.workingDays.filter((d) => d !== dayKey)
      : [...draft.workingDays, dayKey];
    const updated = { ...draft, workingDays: nextDays };
    updateDraftHost(host, { workingDays: nextDays });
    try {
      await onSaveHostConfig(updated);
      setActionSuccess(`Jours de disponibilité enregistrés automatiquement pour ${host.name}.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.');
    }
  };

  const handleAddBlockedDate = async (host: HostConfig) => {
    const dt = newBlockedDate[host.hostId];
    if (!dt) return;
    const draft = getDraftHost(host);
    if (!draft.blockedDates.includes(dt)) {
      const nextBlocked = [...draft.blockedDates, dt].sort();
      const updated = { ...draft, blockedDates: nextBlocked };
      updateDraftHost(host, { blockedDates: nextBlocked });
      try {
        await onSaveHostConfig(updated);
        setActionSuccess(`Indisponibilité (${dt}) enregistrée automatiquement pour ${host.name}.`);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.');
      }
    }
    setNewBlockedDate((prev) => ({ ...prev, [host.hostId]: '' }));
  };

  const handleRemoveBlockedDate = async (host: HostConfig, dt: string) => {
    const draft = getDraftHost(host);
    const nextBlocked = draft.blockedDates.filter((d) => d !== dt);
    const updated = { ...draft, blockedDates: nextBlocked };
    updateDraftHost(host, { blockedDates: nextBlocked });
    try {
      await onSaveHostConfig(updated);
      setActionSuccess(`Date (${dt}) débloquée et enregistrée automatiquement pour ${host.name}.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.');
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminUid.trim() || !newAdminEmail.trim()) return;
    setActionError(null);
    try {
      await onAddAdminUser({
        uid: newAdminUid.trim(),
        email: newAdminEmail.trim().toLowerCase(),
        displayName: newAdminName.trim() || newAdminEmail.trim(),
        role: 'host_admin',
        hostId: newAdminHostId,
      });
      setNewAdminUid('');
      setNewAdminEmail('');
      setNewAdminName('');
      setActionSuccess('Administrateur ajouté.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erreur lors de l’ajout.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Admin Top Header */}
      <section className="bg-white border border-slate-300/90 rounded-2xl p-6 space-y-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Secrétariat &amp; Validation · Connecté en tant que {currentUserEmail}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">
              Tableau de bord d’administration des rendez-vous
            </h1>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 self-start md:self-auto whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            Déconnexion
          </button>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-slate-200">
          <div className="bg-orange-50/75 border border-orange-200 rounded-xl p-4">
            <div className="text-xs font-medium text-orange-800">En attente de validation</div>
            <div className="mt-1 font-display text-2xl font-bold text-orange-700 tabular-nums">
              {appointmentStats.pending}
            </div>
          </div>
          <div className="bg-emerald-50/75 border border-emerald-200 rounded-xl p-4">
            <div className="text-xs font-medium text-emerald-800">Confirmés</div>
            <div className="mt-1 font-display text-2xl font-bold text-emerald-700 tabular-nums">
              {appointmentStats.confirmed}
            </div>
          </div>
          <div className="bg-[#F4F7FB] border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-medium text-slate-600">À reprogrammer / Refusés</div>
            <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {appointmentStats.declined}
            </div>
          </div>
          <div className="bg-[#F4F7FB] border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-medium text-slate-600">Total des demandes</div>
            <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {appointmentStats.total}
            </div>
          </div>
        </div>

        {/* Sub-navigation */}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => setSubTab('demandes')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
              subTab === 'demandes'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <CalendarCheck className="w-4 h-4" />
            Demandes &amp; Validation ({appointmentStats.pending})
          </button>

          <button
            type="button"
            onClick={() => setSubTab('planning')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
              subTab === 'planning'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            Planning visuel
          </button>

          <button
            type="button"
            onClick={() => setSubTab('calendars')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
              subTab === 'calendars'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Calendar className="w-4 h-4" />
            Agendas Google &amp; Disponibilités
          </button>

          <button
            type="button"
            onClick={() => setSubTab('notifications')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
              subTab === 'notifications'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Bell className="w-4 h-4" />
            Notifications & Historique ({unreadAdminNotifs})
          </button>

          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setSubTab('team')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                subTab === 'team'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Shield className="w-4 h-4" />
              Accès Équipe
            </button>
          )}
        </div>
      </section>

      {actionError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-300 text-red-900 rounded-xl p-4 text-sm flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-red-800 font-semibold text-xs shrink-0"
          >
            Fermer
          </button>
        </div>
      )}

      {actionSuccess && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl p-4 text-sm flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
            <span>{actionSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            className="text-emerald-800 font-semibold text-xs shrink-0"
          >
            Fermer
          </button>
        </div>
      )}

      {/* VIEW 1: DEMANDES & VALIDATION */}
      {subTab === 'demandes' && (
        <div className="space-y-5">
          {/* 1-Click WhatsApp Daily Briefing Card */}
          <div className="bg-emerald-50/75 border border-emerald-200 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Briefing du jour WhatsApp (équipe &amp; direction)
              </div>
              <p className="text-xs sm:text-sm text-emerald-950">
                Envoyez en 1 clic le récapitulatif des présences et des rendez-vous confirmés à Monsieur Jean-Jacques, Vénicia et Madame Joël.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(dailyBriefingText);
                    setBriefingCopied(true);
                    window.setTimeout(() => setBriefingCopied(false), 2500);
                  } catch {
                    setActionError('Copie automatique impossible sur ce navigateur.');
                  }
                }}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold transition-colors"
              >
                {briefingCopied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-700" />
                    Briefing copié
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-emerald-700" />
                    Copier le briefing
                  </>
                )}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(dailyBriefingText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold transition-colors shadow-xs"
              >
                <MessageCircle className="w-4 h-4" />
                Envoyer sur WhatsApp
              </a>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="bg-white border border-slate-300 rounded-xl p-4 flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 mr-1">
              <Filter className="w-4 h-4" />
              Filtrer :
            </div>

            <select
              value={filterHost}
              onChange={(e) => setFilterHost(e.target.value as 'all' | HostId)}
              aria-label="Filtrer par personne"
              className="h-10 px-3 bg-slate-50 border border-slate-300 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:border-emerald-600"
            >
              <option value="all">Toutes les personnes</option>
              {hosts.map((h) => (
                <option key={h.hostId} value={h.hostId}>
                  {h.name}
                </option>
              ))}
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'all' | AppointmentStatus)}
              aria-label="Filtrer par statut"
              className="h-10 px-3 bg-slate-50 border border-slate-300 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:border-emerald-600"
            >
              <option value="all">Tous les statuts</option>
              <option value="pending">En attente de validation</option>
              <option value="confirmed">Confirmé</option>
              <option value="declined_or_reschedule">Refusé ou à reprogrammer</option>
            </select>

            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              aria-label="Filtrer par date"
              className="h-10 px-3 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono tabular-nums text-slate-800 focus:outline-none focus:border-emerald-600"
            />

            {(filterHost !== 'all' || filterStatus !== 'all' || filterDate) && (
              <button
                type="button"
                onClick={() => {
                  setFilterHost('all');
                  setFilterStatus('all');
                  setFilterDate('');
                }}
                className="text-xs font-semibold text-orange-700 hover:text-orange-900 underline underline-offset-2 ml-auto"
              >
                Réinitialiser
              </button>
            )}
          </div>

          {filteredAppointments.length === 0 ? (
            <div className="bg-white border border-slate-300 rounded-xl p-10 text-center text-sm text-slate-600">
              Aucune demande de rendez-vous ne correspond aux filtres sélectionnés.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredAppointments.map((appt) => {
                const isBusy = processingId === appt.id;
                const matchedGuest = findMatchingGuest(appt.requesterName);
                const requesterWaHref = buildRequesterWhatsAppHref(appt);
                const telDigits = appt.requesterPhone.replace(/[^\d+]/g, '');
                const reasonLabel =
                  appt.reason === 'Autre' && appt.customReason
                    ? `Autre : ${appt.customReason}`
                    : appt.reason;

                return (
                  <article
                    key={appt.id}
                    className="bg-white border border-slate-300/90 rounded-2xl p-5 sm:p-6 space-y-4 shadow-xs"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span className="font-mono font-semibold text-slate-600">
                            {appt.trackingCode}
                          </span>
                          <span aria-hidden="true">·</span>
                          {appt.status === 'confirmed' ? (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                              <CheckCircle2 className="w-4 h-4" />
                              Confirmé
                            </span>
                          ) : appt.status === 'declined_or_reschedule' ? (
                            <span className="inline-flex items-center gap-1 font-bold text-orange-700">
                              <CalendarX className="w-4 h-4" />
                              Refusé ou à reprogrammer
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-bold text-amber-700">
                              <Clock className="w-4 h-4" />
                              En attente de validation
                            </span>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-slate-700 capitalize">
                            {appt.format}
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          {matchedGuest?.photoUrl && (
                            <img
                              src={matchedGuest.photoUrl}
                              alt={matchedGuest.fullName}
                              referrerPolicy="no-referrer"
                              className="w-10 h-10 rounded-xl object-cover object-top border border-slate-300 shrink-0"
                            />
                          )}
                          <div>
                            <h2 className="font-display text-lg font-bold text-slate-900">
                              {appt.requesterName}{' '}
                              <span className="font-normal text-slate-500">avec</span>{' '}
                              <span className="text-emerald-700">
                                {appt.hostIds.map(getHostName).join(', ')}
                              </span>
                            </h2>
                            {matchedGuest && (
                              <p className="text-xs text-emerald-800 font-medium">
                                Invité officiel N° {String(matchedGuest.orderNumber).padStart(2, '0')} ·{' '}
                                {matchedGuest.nationality} ·{' '}
                                {matchedGuest.checkedIn ? 'Déjà reçu' : 'En attente d’arrivée'}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 pt-0.5">
                          <a
                            href={`tel:${telDigits}`}
                            className="inline-flex items-center gap-1.5 font-mono text-slate-800 hover:text-emerald-700 underline underline-offset-2"
                          >
                            <Phone className="w-3.5 h-3.5 text-slate-500" />
                            {appt.requesterPhone}
                          </a>
                          {appt.requesterEmail && (
                            <a
                              href={`mailto:${appt.requesterEmail}?subject=${encodeURIComponent(
                                `Bilili BD Festival 2026 — Votre rendez-vous (${appt.trackingCode})`
                              )}`}
                              className="inline-flex items-center gap-1.5 text-slate-800 hover:text-emerald-700 underline underline-offset-2"
                            >
                              <Mail className="w-3.5 h-3.5 text-slate-500" />
                              {appt.requesterEmail}
                            </a>
                          )}
                          {requesterWaHref && (
                            <a
                              href={requesterWaHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              Contacter sur WhatsApp
                            </a>
                          )}
                          <span className="inline-flex items-center gap-1.5">
                            {appt.format === 'présentiel' ? (
                              <MapPin className="w-3.5 h-3.5 text-slate-400" />
                            ) : (
                              <Video className="w-3.5 h-3.5 text-slate-400" />
                            )}
                            {reasonLabel}
                          </span>
                        </div>
                      </div>

                      <div className="bg-[#F4F7FB] border border-slate-200 rounded-xl px-4 py-3 text-right shrink-0">
                        <div className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                          {appt.desiredDate} · {appt.desiredTime}
                        </div>
                        <div className="text-xs text-slate-600 tabular-nums mt-0.5">
                          Durée estimée : {appt.durationMinutes} min
                        </div>
                      </div>
                    </div>

                    {appt.description && (
                      <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3.5 leading-relaxed">
                        {appt.description}
                      </p>
                    )}

                    {appt.adminComment && (
                      <p className="text-xs text-slate-700 bg-orange-50/70 border border-orange-200 rounded-lg px-3.5 py-2.5">
                        <span className="font-semibold">Note d’administration : </span>
                        {appt.adminComment}
                        {appt.proposedDate && appt.proposedTime && (
                          <span className="font-mono font-semibold ml-1">
                            ({appt.proposedDate} à {appt.proposedTime})
                          </span>
                        )}
                      </p>
                    )}

                    {/* Synced Google Calendar Links */}
                    {appt.calendarEvents && appt.calendarEvents.length > 0 && (
                      <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                        <span className="font-semibold text-emerald-800">
                          Synchronisé dans Google Agenda :
                        </span>
                        {appt.calendarEvents.map((evt) => (
                          <a
                            key={`${evt.hostId}-${evt.eventId}`}
                            href={evt.htmlLink || 'https://calendar.google.com'}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
                          >
                            {evt.hostName}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center gap-2.5">
                      {appt.status !== 'confirmed' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleConfirmAndSync(appt)}
                          className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-60"
                        >
                          <Check className="w-4 h-4" />
                          {isBusy
                            ? 'Validation & synchronisation...'
                            : 'Accepter & Ajouter à Google Agenda'}
                        </button>
                      )}

                      {appt.status === 'confirmed' &&
                        (appt.calendarEvents?.length || 0) < appt.hostIds.length && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleConfirmAndSync(appt)}
                            className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-60"
                          >
                            <RefreshCw className="w-4 h-4" />
                            Synchroniser les agendas manquants
                          </button>
                        )}

                      {appt.status !== 'confirmed' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            setRescheduleTarget(appt);
                            setProposedDate(appt.desiredDate);
                            setProposedTime(appt.desiredTime);
                            setAdminComment('');
                          }}
                          className="h-10 px-4 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors"
                        >
                          <Clock className="w-4 h-4" />
                          Refuser / Proposer un autre créneau
                        </button>
                      )}

                      {appt.status === 'confirmed' && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              downloadAppointmentICS({
                                trackingCode: appt.trackingCode,
                                title: `Bilili BD 2026 — ${reasonLabel} (${appt.requesterName})`,
                                date: appt.desiredDate,
                                time: appt.desiredTime,
                                durationMinutes: appt.durationMinutes,
                                format: appt.format,
                                hostNames: appt.hostIds.map(getHostName).join(', '),
                                description: appt.description,
                              })
                            }
                            className="h-10 px-3.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors"
                          >
                            <CalendarPlus className="w-4 h-4" />
                            Fichier .ics
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              setConfirmCalendarMutation({
                                mode: 'update',
                                appointment: appt,
                                newDate: appt.desiredDate,
                                newTime: appt.desiredTime,
                                newDuration: appt.durationMinutes,
                                comment: '',
                              })
                            }
                            className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold transition-colors"
                          >
                            Modifier le créneau
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              setConfirmCalendarMutation({
                                mode: 'cancel',
                                appointment: appt,
                                newDate: appt.desiredDate,
                                newTime: appt.desiredTime,
                                newDuration: appt.durationMinutes,
                                comment: '',
                              })
                            }
                            className="h-10 px-4 rounded-lg border border-red-300 bg-red-50 hover:bg-red-100 text-red-800 text-xs sm:text-sm font-semibold transition-colors"
                          >
                            Annuler le rendez-vous
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* VIEW 1B: VISUAL HOST SCHEDULE */}
      {subTab === 'planning' && (
        <HostVisualSchedule hosts={hosts} appointments={appointments} />
      )}

      {/* VIEW 2: GOOGLE CALENDARS & AVAILABILITY PER HOST */}
      {subTab === 'calendars' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {hosts.map((host) => {
            const draft = getDraftHost(host);
            const sessionToken = getHostAccessToken(host.hostId);
            const sessionEmail = getHostConnectedSessionEmail(host.hostId);
            const availableCalendars = hostCalendarLists[host.hostId] || [];

            return (
              <section
                key={host.hostId}
                className="bg-white border border-slate-300/90 rounded-2xl p-6 space-y-5 flex flex-col justify-between shadow-xs"
              >
                <div className="space-y-5">
                  <div className="pb-4 border-b border-slate-200">
                    <h2 className="font-display text-lg font-bold text-slate-900">
                      {host.name}
                    </h2>
                    <p className="text-xs text-slate-600 mt-0.5">{host.role}</p>
                  </div>

                  {/* Google Account Connection Block */}
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                    <div className="text-xs font-semibold text-slate-800">
                      Compte Google Agenda dédié
                    </div>
                    {sessionToken ? (
                      <div className="text-xs text-emerald-800 font-medium flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                        Session active : {sessionEmail || host.googleConnectedEmail}
                      </div>
                    ) : host.googleConnected ? (
                      <div className="text-xs text-orange-800 font-medium">
                        Compte configuré ({host.googleConnectedEmail}). Reconnectez pour cette session afin de synchroniser en direct.
                      </div>
                    ) : (
                      <div className="text-xs text-slate-600">
                        Aucun compte Google connecté pour l’instant.
                      </div>
                    )}

                    <GoogleSignInButton
                      label={
                        sessionToken
                          ? `Changer le compte (${host.name})`
                          : `Connecter Google (${host.name})`
                      }
                      onClick={() => handleConnectHostGoogle(host)}
                      loading={connectingHost === host.hostId}
                      className="w-full"
                    />
                  </div>

                  {/* Calendar ID selector */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Agenda Google cible (ou ID d’agenda partagé)
                    </label>
                    {availableCalendars.length > 0 ? (
                      <select
                        value={draft.googleCalendarId}
                        onChange={(e) =>
                          updateDraftHost(host, { googleCalendarId: e.target.value })
                        }
                        className="w-full h-10 px-3 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600"
                      >
                        {availableCalendars.map((cal) => (
                          <option key={cal.id} value={cal.id}>
                            {cal.summary} {cal.primary ? '(Principal)' : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={draft.googleCalendarId}
                        onChange={(e) =>
                          updateDraftHost(host, { googleCalendarId: e.target.value })
                        }
                        placeholder="primary ou adresse@gmail.com"
                        className="w-full h-10 px-3 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:border-emerald-600"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      E-mail de notification / participant
                    </label>
                    <input
                      type="email"
                      value={draft.email}
                      onChange={(e) => updateDraftHost(host, { email: e.target.value })}
                      placeholder="exemple@bililibd.org"
                      className="w-full h-10 px-3 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600"
                    />
                  </div>

                  {/* Working days */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Jours de disponibilité
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAYS.map((wd) => {
                        const active = draft.workingDays.includes(wd.key);
                        return (
                          <button
                            key={wd.key}
                            type="button"
                            onClick={() => handleToggleWeekday(host, wd.key)}
                            className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                              active
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {wd.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Working hours */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Début
                      </label>
                      <input
                        type="time"
                        value={draft.startHour}
                        onChange={(e) => updateDraftHost(host, { startHour: e.target.value })}
                        className="w-full h-10 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Fin
                      </label>
                      <input
                        type="time"
                        value={draft.endHour}
                        onChange={(e) => updateDraftHost(host, { endHour: e.target.value })}
                        className="w-full h-10 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono tabular-nums"
                      />
                    </div>
                  </div>

                  {/* Blocked dates */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      Dates bloquées (indisponibilités)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={newBlockedDate[host.hostId] || ''}
                        onChange={(e) =>
                          setNewBlockedDate((prev) => ({
                            ...prev,
                            [host.hostId]: e.target.value,
                          }))
                        }
                        className="flex-1 h-9 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddBlockedDate(host)}
                        className="h-9 px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                      >
                        Bloquer
                      </button>
                    </div>
                    {draft.blockedDates.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {draft.blockedDates.map((dt) => (
                          <button
                            key={dt}
                            type="button"
                            onClick={() => handleRemoveBlockedDate(host, dt)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-orange-50 border border-orange-200 text-xs font-mono text-orange-800 hover:bg-orange-100"
                          >
                            {dt}
                            <X className="w-3 h-3" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={savingHostId === host.hostId}
                  onClick={() => handleSaveHost(host)}
                  className="w-full h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
                >
                  {savingHostId === host.hostId
                    ? 'Enregistrement...'
                    : 'Enregistrer la configuration'}
                </button>
              </section>
            );
          })}
        </div>
      )}

      {/* VIEW 3: NOTIFICATIONS & HISTORY */}
      {subTab === 'notifications' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-5 bg-white border border-slate-300 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <Bell className="w-5 h-5 text-orange-600" />
              Notifications Administration
            </h2>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
              {notifications.filter((n) => n.recipientRole === 'admin').length === 0 ? (
                <p className="p-4 text-sm text-slate-500">Aucune notification pour le moment.</p>
              ) : (
                notifications
                  .filter((n) => n.recipientRole === 'admin')
                  .map((notif) => (
                    <div
                      key={notif.id}
                      className={`p-4 space-y-1.5 ${
                        notif.read ? 'bg-white' : 'bg-orange-50/60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">
                          {notif.title}
                        </span>
                        {!notif.read && (
                          <button
                            type="button"
                            onClick={() => onMarkNotificationRead(notif.id)}
                            className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 shrink-0"
                          >
                            Marquer lu
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{notif.message}</p>
                    </div>
                  ))
              )}
            </div>
          </section>

          <section className="lg:col-span-7 bg-white border border-slate-300 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <History className="w-5 h-5 text-emerald-700" />
              Historique complet des rendez-vous ({appointments.length})
            </h2>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">Code</th>
                    <th className="py-2.5 px-3">Demandeur</th>
                    <th className="py-2.5 px-3">Personne(s)</th>
                    <th className="py-2.5 px-3">Créneau</th>
                    <th className="py-2.5 px-3">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {appointments.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-700">
                        {a.trackingCode}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        {a.requesterName}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">
                        {a.hostIds.map(getHostName).join(', ')}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700">
                        {a.desiredDate} {a.desiredTime}
                      </td>
                      <td className="py-2.5 px-3 font-semibold">
                        {a.status === 'confirmed' ? (
                          <span className="text-emerald-700">Confirmé</span>
                        ) : a.status === 'declined_or_reschedule' ? (
                          <span className="text-orange-700">À reprogrammer</span>
                        ) : (
                          <span className="text-amber-700">En attente</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* VIEW 4: TEAM ACCESS (SUPER ADMIN ONLY) */}
      {subTab === 'team' && isSuperAdmin && (
        <section className="bg-white border border-slate-300 rounded-xl p-6 space-y-6">
          <div className="space-y-1">
            <h2 className="font-display text-lg font-bold text-slate-900">
              Gestion des accès administrateur
            </h2>
            <p className="text-xs text-slate-600">
              Ajoutez les identifiants Firebase (UID + E-mail Google) de Monsieur Jean-Jacques, Vénicia ou Madame Joël pour leur ouvrir l’accès direct à cet espace d’administration.
            </p>
          </div>

          <form
            onSubmit={handleCreateAdmin}
            className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-4"
          >
            <input
              type="text"
              required
              value={newAdminUid}
              onChange={(e) => setNewAdminUid(e.target.value)}
              placeholder="UID utilisateur Firebase"
              className="h-10 px-3 bg-white border border-slate-300 rounded-lg text-xs font-mono"
            />
            <input
              type="email"
              required
              value={newAdminEmail}
              onChange={(e) => setNewAdminEmail(e.target.value)}
              placeholder="E-mail Google"
              className="h-10 px-3 bg-white border border-slate-300 rounded-lg text-xs"
            />
            <input
              type="text"
              value={newAdminName}
              onChange={(e) => setNewAdminName(e.target.value)}
              placeholder="Nom affiché"
              className="h-10 px-3 bg-white border border-slate-300 rounded-lg text-xs"
            />
            <div className="flex gap-2">
              <select
                value={newAdminHostId}
                onChange={(e) => setNewAdminHostId(e.target.value as 'all' | HostId)}
                className="flex-1 h-10 px-2.5 bg-white border border-slate-300 rounded-lg text-xs"
              >
                <option value="all">Tous</option>
                <option value="jean-jacques">Jean-Jacques</option>
                <option value="venicia">Vénicia</option>
                <option value="joel">Madame Joël</option>
              </select>
              <button
                type="submit"
                className="h-10 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1"
              >
                <Plus className="w-4 h-4" />
                Ajouter
              </button>
            </div>
          </form>

          <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
            {adminUsers.map((adm) => (
              <div
                key={adm.uid}
                className="p-3.5 flex items-center justify-between gap-4 text-sm"
              >
                <div className="flex items-center gap-3">
                  <UserCheck className="w-4 h-4 text-emerald-700" />
                  <div>
                    <div className="font-semibold text-slate-900">{adm.displayName}</div>
                    <div className="text-xs text-slate-500 font-mono">
                      {adm.email} · {adm.uid}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteAdminUser(adm.uid)}
                  className="p-2 text-red-700 hover:bg-red-50 rounded-lg"
                  title="Retirer cet accès"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Reschedule / Refuse Modal */}
      {rescheduleTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSubmitReschedule}
            className="bg-white border border-slate-300 rounded-xl max-w-lg w-full p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  Refuser ou proposer un autre créneau
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Demande de {rescheduleTarget.requesterName} ({rescheduleTarget.trackingCode})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRescheduleTarget(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nouvelle date proposée (optionnel)
                </label>
                <input
                  type="date"
                  value={proposedDate}
                  onChange={(e) => setProposedDate(e.target.value)}
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nouvelle heure proposée
                </label>
                <input
                  type="time"
                  value={proposedTime}
                  onChange={(e) => setProposedTime(e.target.value)}
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Message pour le demandeur
              </label>
              <textarea
                rows={3}
                value={adminComment}
                onChange={(e) => setAdminComment(e.target.value)}
                maxLength={1000}
                placeholder="Indiquez la raison ou le nouveau créneau suggéré..."
                className="w-full p-3 bg-slate-50 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRescheduleTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={processingId === rescheduleTarget.id}
                className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold"
              >
                Envoyer la décision
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Mandatory Confirmation Dialog before modifying/deleting Google Calendar events */}
      {confirmCalendarMutation && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-300 rounded-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="font-display text-lg font-bold text-slate-900">
                  {confirmCalendarMutation.mode === 'cancel'
                    ? 'Confirmer l’annulation et la suppression dans Google Agenda'
                    : 'Confirmer la modification dans Google Agenda'}
                </h3>
                <p className="text-xs text-slate-600">
                  Cette action mettra à jour les agendas Google synchronisés pour ce rendez-vous ({confirmCalendarMutation.appointment.trackingCode}).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmCalendarMutation(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {confirmCalendarMutation.mode === 'update' && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={confirmCalendarMutation.newDate}
                    onChange={(e) =>
                      setConfirmCalendarMutation((prev) =>
                        prev ? { ...prev, newDate: e.target.value } : null
                      )
                    }
                    className="w-full h-10 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Heure
                  </label>
                  <input
                    type="time"
                    value={confirmCalendarMutation.newTime}
                    onChange={(e) =>
                      setConfirmCalendarMutation((prev) =>
                        prev ? { ...prev, newTime: e.target.value } : null
                      )
                    }
                    className="w-full h-10 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Durée (min)
                  </label>
                  <input
                    type="number"
                    min={15}
                    max={240}
                    step={15}
                    value={confirmCalendarMutation.newDuration}
                    onChange={(e) =>
                      setConfirmCalendarMutation((prev) =>
                        prev ? { ...prev, newDuration: Number(e.target.value) } : null
                      )
                    }
                    className="w-full h-10 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Motif / commentaire de mise à jour
              </label>
              <textarea
                rows={2}
                value={confirmCalendarMutation.comment}
                onChange={(e) =>
                  setConfirmCalendarMutation((prev) =>
                    prev ? { ...prev, comment: e.target.value } : null
                  )
                }
                placeholder="Précision envoyée dans la notification..."
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            {confirmCalendarMutation.appointment.calendarEvents?.length > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 space-y-1">
                <div className="font-semibold">
                  Événement(s) Google Agenda concerné(s) :
                </div>
                {confirmCalendarMutation.appointment.calendarEvents.map((ev) => (
                  <div key={ev.eventId} className="font-mono">
                    • {ev.hostName} (Agenda : {ev.calendarId})
                  </div>
                ))}
              </div>
            )}

            <div className="pt-3 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmCalendarMutation(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700"
              >
                Retour
              </button>
              <button
                type="button"
                disabled={processingId === confirmCalendarMutation.appointment.id}
                onClick={handleExecuteCalendarMutation}
                className={`px-4 py-2 rounded-lg text-white text-sm font-semibold ${
                  confirmCalendarMutation.mode === 'cancel'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {confirmCalendarMutation.mode === 'cancel'
                  ? 'Confirmer l’annulation'
                  : 'Confirmer la modification'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
