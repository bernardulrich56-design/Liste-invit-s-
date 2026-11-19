import React, { useEffect, useState } from 'react';
import {
  Bell,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  Clock,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import { downloadAppointmentICS } from '../services/icsExport';
import { AppNotification, HostConfig, PublicAppointmentStatus } from '../types';

interface TrackingSectionProps {
  hosts: HostConfig[];
  initialTrackingCode: string;
  recentTrackingCodes: string[];
  onLookupStatus: (trackingCode: string) => Promise<{
    statusRecord: PublicAppointmentStatus | null;
    notifications: AppNotification[];
  }>;
}

export const TrackingSection: React.FC<TrackingSectionProps> = ({
  hosts,
  initialTrackingCode,
  recentTrackingCodes,
  onLookupStatus,
}) => {
  const [codeInput, setCodeInput] = useState(initialTrackingCode || recentTrackingCodes[0] || '');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusRecord, setStatusRecord] = useState<PublicAppointmentStatus | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const performLookup = async (code: string) => {
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await onLookupStatus(clean);
      setStatusRecord(res.statusRecord);
      setNotifications(res.notifications);
      if (!res.statusRecord) {
        setErrorMsg(`Aucune demande trouvée pour le code « ${clean} ».`);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Erreur lors de la recherche de votre demande.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialTrackingCode) {
      setCodeInput(initialTrackingCode);
      performLookup(initialTrackingCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTrackingCode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performLookup(codeInput);
  };

  const getHostNames = (hostIds: string[]) =>
    hostIds
      .map((id) => hosts.find((h) => h.hostId === id)?.name || id)
      .join(', ');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <section className="bg-white border border-slate-300/90 rounded-2xl p-6 sm:p-8 space-y-5 shadow-xs">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Suivi en temps réel
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">
            Suivi de votre demande & Notifications
          </h1>
          <p className="text-sm text-slate-600">
            Saisissez votre code de suivi (ex. <span className="font-mono">RDV-...</span>) pour consulter l’état de validation et les décisions de l’équipe.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="Entrez votre code de suivi (ex. RDV-2026-AB12)"
              className="w-full h-11 pl-10 pr-4 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono uppercase focus:outline-none focus:border-emerald-600 focus:bg-white"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !codeInput.trim()}
            className="h-11 px-6 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Vérifier le statut
          </button>
        </form>

        {recentTrackingCodes.length > 0 && (
          <div className="pt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span>Vos demandes récentes :</span>
            {recentTrackingCodes.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => {
                  setCodeInput(code);
                  performLookup(code);
                }}
                className="font-mono font-semibold text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
              >
                {code}
              </button>
            ))}
          </div>
        )}
      </section>

      {errorMsg && (
        <div
          role="alert"
          className="bg-red-50 border border-red-300 text-red-800 rounded-xl p-4 text-sm font-medium"
        >
          {errorMsg}
        </div>
      )}

      {statusRecord && (
        <section className="bg-white border border-slate-300/90 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <div className="text-xs font-mono text-slate-500">
                Référence : {statusRecord.trackingCode}
              </div>
              <h2 className="font-display text-xl font-bold text-slate-900 mt-1">
                Rendez-vous avec {getHostNames(statusRecord.hostIds)}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {statusRecord.status === 'confirmed' ? (
                <>
                  <span className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700">
                    <CheckCircle2 className="w-5 h-5" />
                    Confirmé
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      downloadAppointmentICS({
                        trackingCode: statusRecord.trackingCode,
                        title: `Bilili BD 2026 — ${statusRecord.reason} (${getHostNames(statusRecord.hostIds)})`,
                        date: statusRecord.desiredDate,
                        time: statusRecord.desiredTime,
                        durationMinutes: statusRecord.durationMinutes,
                        format: statusRecord.format,
                        hostNames: getHostNames(statusRecord.hostIds),
                        description: statusRecord.adminComment,
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors shadow-xs"
                  >
                    <CalendarPlus className="w-4 h-4" />
                    Ajouter à mon calendrier (.ics)
                  </button>
                </>
              ) : statusRecord.status === 'declined_or_reschedule' ? (
                <span className="inline-flex items-center gap-2 text-sm font-bold text-orange-700">
                  <XCircle className="w-5 h-5" />
                  Refusé ou à reprogrammer
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 text-sm font-bold text-amber-700">
                  <Clock className="w-5 h-5" />
                  En attente de validation
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5">
              <div className="text-xs text-slate-500">Motif</div>
              <div className="mt-1 font-semibold text-slate-900">{statusRecord.reason}</div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5">
              <div className="text-xs text-slate-500">Date souhaitée</div>
              <div className="mt-1 font-mono font-semibold text-slate-900 tabular-nums">
                {statusRecord.desiredDate}
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5">
              <div className="text-xs text-slate-500">Heure & Durée</div>
              <div className="mt-1 font-mono font-semibold text-slate-900 tabular-nums">
                {statusRecord.desiredTime} · {statusRecord.durationMinutes} min
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5">
              <div className="text-xs text-slate-500">Format</div>
              <div className="mt-1 font-semibold text-slate-900 capitalize">
                {statusRecord.format}
              </div>
            </div>
          </div>

          {(statusRecord.proposedDate || statusRecord.proposedTime || statusRecord.adminComment) && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-orange-900">
                <Calendar className="w-4 h-4" />
                Réponse de l’équipe Bilili
              </div>
              {(statusRecord.proposedDate || statusRecord.proposedTime) && (
                <p className="text-sm text-orange-900 font-medium">
                  Nouveau créneau proposé :{' '}
                  <span className="font-mono font-bold tabular-nums">
                    {statusRecord.proposedDate} à {statusRecord.proposedTime}
                  </span>
                </p>
              )}
              {statusRecord.adminComment && (
                <p className="text-sm text-slate-800">{statusRecord.adminComment}</p>
              )}
            </div>
          )}

          {/* Notifications list */}
          <div className="space-y-3 pt-2">
            <h3 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
              <Bell className="w-4 h-4 text-emerald-700" />
              Historique des notifications ({notifications.length})
            </h3>
            {notifications.length === 0 ? (
              <p className="text-sm text-slate-500">
                Votre demande est en cours d’examen. Les notifications de décision apparaîtront ici.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                {notifications.map((notif) => (
                  <div key={notif.id} className="p-4 bg-slate-50/50 space-y-1">
                    <div className="text-sm font-semibold text-slate-900">{notif.title}</div>
                    <p className="text-sm text-slate-600">{notif.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
