import React, { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  CloudCheck,
  CloudOff,
  Copy,
  FileSpreadsheet,
  Lock,
  MapPin,
  RefreshCw,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import { Guest } from '../types';
import { exportGuestsToExcel } from '../services/csvUtils';
import { GoogleSignInButton } from './GoogleSignInButton';

export type AutoSaveStatus = 'synced' | 'saving' | 'offline_queued' | 'error';

interface ConnectedEcosystemBarProps {
  isAdmin: boolean;
  isSigningIn: boolean;
  authError?: string | null;
  onClearAuthError?: () => void;
  currentUserEmail: string | null;
  autoSaveStatus: AutoSaveStatus;
  lastSavedAt: Date | null;
  lastSavedLabel: string | null;
  isOnline: boolean;
  guests: Guest[];
  onAdminSignIn: () => void;
  onOpenOrganizerSpace: () => void;
  onOpenCalendarSection: () => void;
  onOpenWhatsAppShare: () => void;
}

const IFC_MAPS_URL =
  'https://www.google.com/maps/search/?api=1&query=Institut+fran%C3%A7ais+du+Congo+Brazzaville';

export const ConnectedEcosystemBar: React.FC<ConnectedEcosystemBarProps> = ({
  isAdmin,
  isSigningIn,
  authError = null,
  onClearAuthError,
  currentUserEmail,
  autoSaveStatus,
  lastSavedAt,
  lastSavedLabel,
  isOnline,
  guests,
  onAdminSignIn,
  onOpenOrganizerSpace,
  onOpenCalendarSection,
  onOpenWhatsAppShare,
}) => {
  const [copiedVenue, setCopiedVenue] = useState(false);

  const handleCopyMapsLink = async () => {
    try {
      await navigator.clipboard.writeText(IFC_MAPS_URL);
      setCopiedVenue(true);
      window.setTimeout(() => setCopiedVenue(false), 2500);
    } catch {
      setCopiedVenue(false);
    }
  };

  const formattedTime = lastSavedAt
    ? lastSavedAt.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  return (
    <div className="space-y-3 mb-6">
      {/* Firebase Auto-Save Status Strip (Organizer) OR Read-Only Shield Strip (Visitor) */}
      {isAdmin ? (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-2xl border px-4 py-3 sm:px-5 flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors ${
            autoSaveStatus === 'error'
              ? 'bg-red-50 border-red-300 text-red-900'
              : !isOnline || autoSaveStatus === 'offline_queued'
              ? 'bg-orange-50 border-orange-300 text-orange-950'
              : 'bg-white border-emerald-300/90 text-slate-900 shadow-xs'
          }`}
        >
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                autoSaveStatus === 'saving'
                  ? 'bg-orange-100 text-orange-700'
                  : !isOnline || autoSaveStatus === 'offline_queued'
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {autoSaveStatus === 'saving' ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : !isOnline || autoSaveStatus === 'offline_queued' ? (
                <CloudOff className="w-4 h-4" />
              ) : (
                <CloudCheck className="w-4 h-4" />
              )}
            </div>

            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-bold text-slate-900 flex flex-wrap items-center gap-x-2">
                <span>
                  {autoSaveStatus === 'saving'
                    ? 'Sauvegarde automatique Firebase en cours...'
                    : !isOnline || autoSaveStatus === 'offline_queued'
                    ? 'Hors ligne — Modifications mises en file pour synchronisation Firebase'
                    : 'Sauvegarde automatique Firebase active'}
                </span>
                {formattedTime && (
                  <span className="font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                    · Enregistré à {formattedTime}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 truncate mt-0.5">
                {lastSavedLabel
                  ? lastSavedLabel
                  : `Organisateur confirmé (${currentUserEmail}) · Chaque ajout ou modification est enregistré automatiquement en temps réel.`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0 self-start md:self-auto">
            <span className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 whitespace-nowrap">
              Écriture autorisée · Temps réel
            </span>
            <button
              type="button"
              onClick={onOpenOrganizerSpace}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg px-3 py-1.5 whitespace-nowrap transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Espace Organisateur
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="bg-white border border-slate-300/90 rounded-2xl px-4 py-3 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4 text-orange-600" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-bold text-slate-900">
                  Mode lecture seule · Données protégées par l’organisateur
                </p>
                <p className="text-xs text-slate-600">
                  Vous pouvez consulter la liste, exporter le PDF/CSV et réserver
                  un rendez-vous (enregistré automatiquement sur Firebase). Seul
                  l’organisateur peut modifier le registre.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <GoogleSignInButton
                label="Compte Organisateur"
                onClick={onAdminSignIn}
                loading={isSigningIn}
              />
              <button
                type="button"
                onClick={onOpenOrganizerSpace}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-800 whitespace-nowrap transition-colors"
              >
                Ouvrir Organisateur
              </button>
            </div>
          </div>

          {authError && (
            <div
              role="alert"
              className="bg-red-50 border border-red-300 text-red-900 rounded-xl px-4 py-3 text-xs sm:text-sm flex items-start justify-between gap-3"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
              {onClearAuthError && (
                <button
                  type="button"
                  onClick={onClearAuthError}
                  className="text-xs font-semibold text-red-800 underline shrink-0"
                >
                  Fermer
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Companion Applications Strip */}
      <div className="bg-[#F4F7FB] border border-slate-300/80 rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">
          Applications &amp; outils associés :
        </span>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenWhatsAppShare}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:border-emerald-600 text-xs font-semibold text-slate-800 transition-colors whitespace-nowrap"
          >
            <Share2 className="w-3.5 h-3.5 text-emerald-700" />
            WhatsApp
          </button>

          <button
            type="button"
            onClick={() => void exportGuestsToExcel(guests, isAdmin)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:border-emerald-600 text-xs font-semibold text-slate-800 transition-colors whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            Excel (.xlsx)
          </button>

          <button
            type="button"
            onClick={onOpenCalendarSection}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:border-orange-600 text-xs font-semibold text-slate-800 transition-colors whitespace-nowrap"
          >
            <Calendar className="w-3.5 h-3.5 text-orange-600" />
            Google Agenda
          </button>

          <a
            href={IFC_MAPS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:border-slate-500 text-xs font-semibold text-slate-800 transition-colors whitespace-nowrap"
          >
            <MapPin className="w-3.5 h-3.5 text-slate-700" />
            Plan Google Maps (IFC)
          </a>

          <button
            type="button"
            onClick={handleCopyMapsLink}
            title="Copier le lien Google Maps du lieu"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors whitespace-nowrap"
          >
            {copiedVenue ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-700" />
                Lieu copié
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-500" />
                Copier lieu
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
