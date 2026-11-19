import React from 'react';
import { AlertTriangle, Eye, Lock, LogOut, ShieldCheck } from 'lucide-react';
import { FESTIVAL_LOGO_URL } from '../data/initialData';
import { GoogleSignInButton } from './GoogleSignInButton';

interface OrganizerGateModalProps {
  open: boolean;
  currentUserEmail: string | null;
  isSigningIn: boolean;
  authError?: string | null;
  onClearAuthError?: () => void;
  onConfirmOrganizerGoogle: () => void;
  onContinueReadOnly: () => void;
  onSwitchAccount: () => void;
}

export const OrganizerGateModal: React.FC<OrganizerGateModalProps> = ({
  open,
  currentUserEmail,
  isSigningIn,
  authError = null,
  onClearAuthError,
  onConfirmOrganizerGoogle,
  onContinueReadOnly,
  onSwitchAccount,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="organizer-gate-title"
    >
      <div className="bg-white border border-slate-300/90 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-900 px-6 py-5 text-white flex items-center gap-4">
          <img
            src={FESTIVAL_LOGO_URL}
            alt="Logo Bilili BD Festival 2026"
            referrerPolicy="no-referrer"
            className="w-12 h-12 rounded-xl object-cover bg-slate-950 ring-2 ring-white/20 shrink-0"
          />
          <div>
            <p className="text-xs font-medium text-emerald-300">
              Bilili BD Festival 2026 · Institut français du Congo
            </p>
            <h2
              id="organizer-gate-title"
              className="font-display text-lg sm:text-xl font-bold leading-snug"
            >
              Confirmation du compte Organisateur
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <div className="space-y-3 text-sm text-slate-700 leading-relaxed">
            <div className="bg-[#F4F7FB] border border-slate-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Accès Organisateur (Écriture & Sauvegarde Firebase)</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Seul l’organisateur confirmé via son compte Google peut inscrire,
                modifier ou supprimer des invités, gérer les disponibilités et
                valider les rendez-vous. Chaque changement est enregistré
                automatiquement sur Firebase.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <Lock className="w-4 h-4 text-orange-600 shrink-0" />
                <span>Visiteurs & Contacts partagés (Lecture seule)</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Les autres personnes peuvent consulter la liste publique des
                invités, exporter le PDF et soumettre une demande de
                rendez-vous, sans pouvoir modifier les données internes.
              </p>
            </div>
          </div>

          {authError && (
            <div
              role="alert"
              className="bg-red-50 border border-red-300 rounded-xl p-3.5 text-xs text-red-900 space-y-1.5"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{authError}</span>
              </div>
              {onClearAuthError && (
                <button
                  type="button"
                  onClick={onClearAuthError}
                  className="font-semibold text-red-800 underline underline-offset-2"
                >
                  Fermer
                </button>
              )}
            </div>
          )}

          {currentUserEmail && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3.5 text-xs text-orange-950 space-y-2">
              <p className="font-medium">
                Le compte connecté{' '}
                <span className="font-mono font-bold">{currentUserEmail}</span>{' '}
                dispose uniquement d’un accès en lecture seule.
              </p>
              <button
                type="button"
                onClick={onSwitchAccount}
                className="inline-flex items-center gap-1.5 font-semibold text-orange-800 hover:text-orange-950 underline underline-offset-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                Déconnecter et choisir le compte Google de l’organisateur
              </button>
            </div>
          )}

          <div className="space-y-2.5 pt-1">
            <GoogleSignInButton
              label="Confirmer mon compte Google (Organisateur)"
              onClick={onConfirmOrganizerGoogle}
              loading={isSigningIn}
              className="w-full h-11"
            />

            <button
              type="button"
              onClick={onContinueReadOnly}
              className="w-full h-11 px-4 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Eye className="w-4 h-4 text-slate-600" />
              Continuer en lecture seule (Visiteur)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
