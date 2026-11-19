import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  MoreVertical,
  PlusSquare,
  Share,
  Smartphone,
  X,
} from 'lucide-react';
import { FESTIVAL_LOGO_URL, SHARED_APP_URL } from '../data/initialData';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'banner' | 'button' | 'compact';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'button',
}) => {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } =
    usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    try {
      return window.sessionStorage.getItem('bilili_pwa_banner_dismissed') === '1';
    } catch {
      return false;
    }
  });

  if (isInstalled) {
    return null;
  }

  if (variant === 'banner' && bannerDismissed) {
    return null;
  }

  const handleDismissBanner = () => {
    setBannerDismissed(true);
    try {
      window.sessionStorage.setItem('bilili_pwa_banner_dismissed', '1');
    } catch {
      // ignore storage errors
    }
  };

  const handleAction = async () => {
    if (isInstallable) {
      setInstalling(true);
      try {
        const accepted = await install();
        if (!accepted) {
          setShowGuideModal(true);
        }
      } finally {
        setInstalling(false);
      }
      return;
    }
    setShowGuideModal(true);
  };

  const handleCopyAppLink = async () => {
    try {
      await navigator.clipboard.writeText(SHARED_APP_URL);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 3000);
    } catch {
      setCopiedLink(false);
    }
  };

  return (
    <>
      {variant === 'banner' ? (
        <div className="mb-5 bg-white border border-emerald-200 rounded-2xl p-4 sm:px-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <img
              src={FESTIVAL_LOGO_URL}
              alt="Icône Bilili BD"
              className="w-11 h-11 rounded-xl object-cover border border-slate-200 bg-slate-900 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">
                Télécharger l&apos;application sur votre téléphone
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                Ajoutez Bilili BD 2026 à votre écran d&apos;accueil pour y
                accéder en un geste, même avec une connexion faible.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleAction}
              disabled={installing}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 transition-colors shadow-xs whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              {isInstallable
                ? installing
                  ? 'Installation...'
                  : "Installer l'application"
                : 'Installer sur téléphone'}
            </button>
            <button
              type="button"
              onClick={handleDismissBanner}
              aria-label="Masquer cette bannière"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleAction}
          disabled={installing}
          className={
            variant === 'compact'
              ? 'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors whitespace-nowrap'
              : 'w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors whitespace-nowrap'
          }
        >
          <Smartphone className="w-4 h-4 shrink-0" />
          {isInstallable
            ? installing
              ? 'Installation...'
              : "Installer l'application"
            : "Installer sur l'écran d'accueil"}
        </button>
      )}

      {showGuideModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-modal-title"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden">
            <div className="px-5 py-4 bg-emerald-600 text-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <img
                  src={FESTIVAL_LOGO_URL}
                  alt="Logo Bilili BD"
                  className="w-9 h-9 rounded-lg object-cover bg-slate-900 border border-white/20"
                />
                <div>
                  <h3
                    id="pwa-install-modal-title"
                    className="font-bold text-base leading-tight"
                  >
                    Installer Bilili BD 2026 sur téléphone
                  </h3>
                  <p className="text-xs text-emerald-100">
                    Application Web Progressive (Android, iPhone &amp; Ordinateur)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                aria-label="Fermer"
                className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-sm text-slate-700 max-h-[80vh] overflow-y-auto">
              {isInIframe && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3.5 text-xs text-orange-950 space-y-2">
                  <p className="font-semibold flex items-center gap-1.5">
                    <ExternalLink className="w-4 h-4 text-orange-600 shrink-0" />
                    Ouvert depuis un aperçu intégré ou WhatsApp
                  </p>
                  <p>
                    Pour installer l&apos;icône sur votre écran d&apos;accueil,
                    ouvrez ce lien directement dans <strong>Google Chrome</strong>{' '}
                    (Android) ou <strong>Safari</strong> (iPhone).
                  </p>
                </div>
              )}

              {/* Direct link copy box */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                <p className="text-xs font-semibold text-slate-700">
                  Lien direct à ouvrir dans Chrome ou Safari :
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={SHARED_APP_URL}
                    aria-label="Lien de l'application"
                    className="flex-1 text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-slate-700 select-all"
                  />
                  <button
                    type="button"
                    onClick={handleCopyAppLink}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shrink-0"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
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

              {/* Android guide */}
              <div
                className={`rounded-xl border p-4 space-y-2 ${
                  !isIOS
                    ? 'border-emerald-300 bg-emerald-50/50'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <p className="font-bold text-slate-900 text-sm">
                  Sur Android (Google Chrome)
                </p>
                <ol className="space-y-1.5 text-xs text-slate-700">
                  <li>
                    1. Ouvrez l&apos;application dans <strong>Chrome</strong>.
                  </li>
                  <li>
                    2. Appuyez sur le menu{' '}
                    <MoreVertical className="inline w-3.5 h-3.5 text-slate-900" />{' '}
                    en haut à droite de votre navigateur.
                  </li>
                  <li>
                    3. Sélectionnez{' '}
                    <strong>« Installer l&apos;application »</strong> ou{' '}
                    <strong>« Ajouter à l&apos;écran d&apos;accueil »</strong>.
                  </li>
                  <li>
                    4. Confirmez en appuyant sur <strong>Installer</strong>.
                  </li>
                </ol>
              </div>

              {/* iPhone / iPad guide */}
              <div
                className={`rounded-xl border p-4 space-y-2 ${
                  isIOS
                    ? 'border-emerald-300 bg-emerald-50/50'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <p className="font-bold text-slate-900 text-sm">
                  Sur iPhone / iPad (Safari)
                </p>
                <ol className="space-y-1.5 text-xs text-slate-700">
                  <li>
                    1. Ouvrez le lien dans <strong>Safari</strong>.
                  </li>
                  <li>
                    2. Appuyez sur le bouton{' '}
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                      Partager <Share className="w-3.5 h-3.5 text-emerald-700" />
                    </span>{' '}
                    en bas de l&apos;écran.
                  </li>
                  <li>
                    3. Faites défiler et appuyez sur{' '}
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                      <PlusSquare className="w-3.5 h-3.5 text-emerald-700" /> Sur
                      l&apos;écran d&apos;accueil
                    </span>
                    .
                  </li>
                  <li>
                    4. Appuyez sur <strong>Ajouter</strong> en haut à droite.
                  </li>
                </ol>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-900 hover:bg-slate-800 text-white transition-colors"
              >
                Compris
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
