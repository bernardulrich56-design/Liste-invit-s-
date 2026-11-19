import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, QrCode, RefreshCw, X } from 'lucide-react';
import { Guest } from '../types';

interface QRScannerModalProps {
  open: boolean;
  guests: Guest[];
  onClose: () => void;
  onMarkCheckedIn: (guest: Guest) => Promise<void>;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  open,
  guests,
  onClose,
  onMarkCheckedIn,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const processingScanRef = useRef(false);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [scanResult, setScanResult] = useState<{
    guest: Guest;
    status: 'checked_in_now' | 'already_checked_in';
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const handleDecodedPayload = useCallback(
    async (raw: string) => {
      if (processingScanRef.current) return;
      const trimmed = raw.trim();
      if (!trimmed) return;

      let matched: Guest | undefined;
      if (trimmed.startsWith('BILILI-GUEST:')) {
        const guestId = trimmed.replace('BILILI-GUEST:', '').trim();
        matched = guests.find((g) => g.id === guestId);
      } else if (/^\d+$/.test(trimmed)) {
        const order = Number(trimmed);
        matched = guests.find((g) => g.orderNumber === order);
      } else {
        const lower = trimmed.toLowerCase();
        matched = guests.find(
          (g) =>
            g.id.toLowerCase() === lower ||
            g.fullName.toLowerCase().includes(lower)
        );
      }

      if (!matched) {
        setErrorMsg(`Aucun invité trouvé pour « ${trimmed} ».`);
        return;
      }

      setErrorMsg(null);
      if (matched.checkedIn) {
        setScanResult({ guest: matched, status: 'already_checked_in' });
        return;
      }

      processingScanRef.current = true;
      try {
        await onMarkCheckedIn(matched);
        setScanResult({ guest: { ...matched, checkedIn: true }, status: 'checked_in_now' });
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Impossible de valider l’arrivée pour ce badge.'
        );
      } finally {
        window.setTimeout(() => {
          processingScanRef.current = false;
        }, 1200);
      }
    },
    [guests, onMarkCheckedIn]
  );

  useEffect(() => {
    if (!open) {
      stopCamera();
      setScanResult(null);
      setErrorMsg(null);
      setCameraError(null);
      return;
    }

    let cancelled = false;

    const startCameraAndScan = async () => {
      setCameraError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          'La caméra n’est pas disponible sur ce navigateur. Utilisez la saisie manuelle ci-dessous.'
        );
        return;
      }

      try {
        const [{ default: jsQR }, stream] = await Promise.all([
          import('jsqr'),
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false,
          }),
        ]);

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          setCameraReady(true);
        }

        const tick = () => {
          if (cancelled) return;
          const v = videoRef.current;
          const c = canvasRef.current;
          if (v && c && v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0, c.width, c.height);
              const imgData = ctx.getImageData(0, 0, c.width, c.height);
              const code = jsQR(imgData.data, imgData.width, imgData.height, {
                inversionAttempts: 'dontInvert',
              });
              if (code?.data) {
                void handleDecodedPayload(code.data);
              }
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) {
          setCameraError(
            'Accès à la caméra refusé ou indisponible. Vous pouvez saisir le N° de badge ou le nom ci-dessous.'
          );
        }
      }
    };

    void startCameraAndScan();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, stopCamera, handleDecodedPayload]);

  if (!open) return null;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    void handleDecodedPayload(manualInput);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-scanner-title"
    >
      <div className="bg-white border border-slate-300 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 id="qr-scanner-title" className="font-display text-lg font-bold text-slate-900">
                Scanner un Badge Invité QR
              </h3>
              <p className="text-xs text-slate-600">
                Pointez la caméra vers le QR code du badge pour valider l’arrivée sur Firebase.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le scanner"
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Camera Viewport */}
        <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-300 aspect-4/3 flex items-center justify-center">
          <video
            ref={videoRef}
            playsInline
            muted
            className={`w-full h-full object-cover ${cameraError ? 'hidden' : 'block'}`}
          />
          <canvas ref={canvasRef} className="hidden" />

          {!cameraReady && !cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-2 p-4 text-center">
              <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
              <span className="text-xs text-slate-200">Initialisation de la caméra...</span>
            </div>
          )}

          {cameraReady && !cameraError && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-8 border-2 border-emerald-400/80 rounded-2xl shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]"
            />
          )}

          {cameraError && (
            <div className="p-5 text-center space-y-2 text-slate-200">
              <Camera className="w-8 h-8 mx-auto text-orange-400" />
              <p className="text-xs leading-relaxed">{cameraError}</p>
            </div>
          )}
        </div>

        {/* Feedback Result */}
        {scanResult && (
          <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-950 space-y-0.5">
              <div className="font-bold text-sm">{scanResult.guest.fullName}</div>
              <div>
                N° {String(scanResult.guest.orderNumber).padStart(2, '0')} ·{' '}
                {scanResult.guest.nationality}
              </div>
              <div className="font-semibold text-emerald-800 pt-0.5">
                {scanResult.status === 'checked_in_now'
                  ? 'Arrivée validée et enregistrée automatiquement sur Firebase.'
                  : 'Cet invité était déjà enregistré comme reçu.'}
              </div>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-800 font-medium">
            {errorMsg}
          </div>
        )}

        {/* Fallback Manual Check-in by Badge Number or Name */}
        <form onSubmit={handleManualSubmit} className="space-y-2 pt-2 border-t border-slate-200">
          <label className="block text-xs font-semibold text-slate-700">
            Ou validation rapide par N° d’ordre / Nom :
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Ex. 4 ou BILILI-GUEST:... ou nom"
              className="flex-1 h-10 px-3 bg-[#F4F7FB] border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
            />
            <button
              type="submit"
              className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold whitespace-nowrap"
            >
              Valider
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
