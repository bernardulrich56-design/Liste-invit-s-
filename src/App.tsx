import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { AdminDashboard } from './components/AdminDashboard';
import { BookingSection } from './components/BookingSection';
import {
  AutoSaveStatus,
  ConnectedEcosystemBar,
} from './components/ConnectedEcosystemBar';
import { GuestRegistry } from './components/GuestRegistry';
import { Navbar } from './components/Navbar';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { TrackingSection } from './components/TrackingSection';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { ImportedGuestRow } from './services/csvUtils';
import {
  DEFAULT_HOSTS,
  INITIAL_GUESTS,
  SUPER_ADMIN_EMAIL,
} from './data/initialData';
import {
  db,
  formatFirebaseAuthError,
  handleFirestoreError,
  initFirebaseAuth,
  OperationType,
  signInWithGoogleAdmin,
  signOutGoogle,
  testFirestoreConnection,
} from './services/firebase';
import {
  ActiveTab,
  AdminUserRecord,
  AppNotification,
  Appointment,
  AppointmentFormat,
  AppointmentReason,
  AppointmentStatus,
  CalendarEventRef,
  Guest,
  HostConfig,
  HostId,
  PublicAppointmentStatus,
} from './types';

function generateTrackingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `RDV-2026-${suffix}`;
}

const LEGACY_GUESTS_STORAGE_KEY = 'bilili_guests_cache_v1';
const LEGACY_GUESTS_PENDING_SYNC_KEY = 'bilili_guests_pending_sync_v1';
const TRACKING_CODES_STORAGE_KEY = 'bilili_recent_tracking_codes_v1';

const PUBLIC_INITIAL_GUESTS: Guest[] = INITIAL_GUESTS.map((g) => ({
  ...g,
  passportNumber: '',
  notes: '',
  allowedAdminEmails: [],
  updatedBy: 'public',
}));

function getInitialTabFromUrl(): ActiveTab {
  try {
    const url = new URL(window.location.href);
    const param = (url.searchParams.get('tab') || '').toLowerCase();
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    const hash = url.hash.replace(/^#\/?/, '').toLowerCase();

    if (
      param === 'admin' ||
      param === 'organisateur' ||
      param === 'organizer' ||
      path === '/admin' ||
      path === '/organisateur' ||
      path === '/organizer' ||
      hash === 'admin' ||
      hash === 'organisateur' ||
      hash === 'organizer'
    ) {
      return 'admin';
    }
    if (
      param === 'booking' ||
      path === '/booking' ||
      path === '/rendez-vous' ||
      hash === 'booking'
    ) {
      return 'booking';
    }
    if (
      param === 'tracking' ||
      path === '/tracking' ||
      path === '/suivi' ||
      hash === 'tracking'
    ) {
      return 'tracking';
    }
  } catch {
    // ignore URL errors
  }
  return 'guests';
}

function loadLegacyPendingGuests(): Guest[] | null {
  try {
    if (window.localStorage.getItem(LEGACY_GUESTS_PENDING_SYNC_KEY) !== 'true') {
      return null;
    }
    const raw = window.localStorage.getItem(LEGACY_GUESTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Guest[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadRecentTrackingCodes(): string[] {
  try {
    const raw = window.localStorage.getItem(TRACKING_CODES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toPublicGuestPayload(guest: {
  orderNumber: number;
  fullName: string;
  nationality: string;
  fullCoverage: boolean;
  coverageNote: string;
  photoUrl: string;
  checkedIn: boolean;
  checkedInAt: string;
  programSchedule?: string;
}) {
  return {
    orderNumber: Number(guest.orderNumber) || 1,
    fullName: (guest.fullName || 'Invité').slice(0, 160),
    nationality: (guest.nationality || 'Non précisée').slice(0, 80),
    fullCoverage: Boolean(guest.fullCoverage),
    coverageNote: (guest.coverageNote || '').slice(0, 200),
    photoUrl: (guest.photoUrl || '').slice(0, 350000),
    checkedIn: Boolean(guest.checkedIn),
    checkedInAt: (guest.checkedInAt || '').slice(0, 64),
    programSchedule: (guest.programSchedule || '').slice(0, 300),
    updatedAt: serverTimestamp(),
  };
}

export default function App() {
  const [activeTab, setActiveTabState] = useState<ActiveTab>(getInitialTabFromUrl);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isDelegatedAdmin, setIsDelegatedAdmin] = useState(false);
  const openAdminAfterSignInRef = useRef(false);

  // Domain state
  const [guests, setGuests] = useState<Guest[]>(PUBLIC_INITIAL_GUESTS);
  const [hosts, setHosts] = useState<HostConfig[]>(DEFAULT_HOSTS);
  const [confirmedPublicSlots, setConfirmedPublicSlots] = useState<PublicAppointmentStatus[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUserRecord[]>([]);

  // Tracking, cross-links & auto-save state
  const isOnline = useOnlineStatus();
  const [activeTrackingCode, setActiveTrackingCode] = useState('');
  const [prefillRequesterName, setPrefillRequesterName] = useState('');
  const [adminSubTab, setAdminSubTab] = useState<
    'demandes' | 'planning' | 'calendars' | 'notifications' | 'team'
  >('demandes');
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [recentTrackingCodes, setRecentTrackingCodes] = useState<string[]>(loadRecentTrackingCodes);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('synced');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [lastSavedLabel, setLastSavedLabel] = useState<string | null>(null);
  const [lastSavedMessage, setLastSavedMessage] = useState<string | null>(null);

  const isSuperAdmin = Boolean(
    user?.emailVerified && user?.email?.toLowerCase() === SUPER_ADMIN_EMAIL
  );
  const isAdmin = isSuperAdmin || isDelegatedAdmin;

  const trackAutoSave = useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
      setAutoSaveStatus('saving');
      try {
        const res = await fn();
        setLastSavedAt(new Date());
        setLastSavedLabel(label);
        setAutoSaveStatus(navigator.onLine ? 'synced' : 'offline_queued');
        return res;
      } catch (err) {
        setAutoSaveStatus('error');
        throw err;
      }
    },
    []
  );

  const setActiveTab = useCallback((tab: ActiveTab) => {
    setActiveTabState(tab);
    try {
      const url = new URL(window.location.href);
      url.pathname = '/';
      url.hash = '';
      if (tab === 'guests') {
        url.searchParams.delete('tab');
      } else {
        url.searchParams.set('tab', tab);
      }
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore history errors in sandboxed iframes
    }
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      // ignore scroll errors
    }
  }, []);

  // Auto-hide save feedback banner
  useEffect(() => {
    if (!lastSavedMessage) return;
    const timer = window.setTimeout(() => setLastSavedMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [lastSavedMessage]);

  // Persist recent tracking codes
  useEffect(() => {
    try {
      window.localStorage.setItem(TRACKING_CODES_STORAGE_KEY, JSON.stringify(recentTrackingCodes));
    } catch {
      // ignore storage quota errors
    }
  }, [recentTrackingCodes]);

  // Initialize connection & Firebase auth listener
  useEffect(() => {
    testFirestoreConnection();
    const unsub = initFirebaseAuth(
      (firebaseUser) => {
        setUser(firebaseUser);
        if (firebaseUser) {
          setAuthError(null);
        }
        setIsAuthReady(true);
      },
      (message) => {
        setAuthError(message);
      }
    );
    return () => unsub();
  }, []);

  // Verify delegated admin status when user signs in
  useEffect(() => {
    if (!user || !user.emailVerified) {
      setIsDelegatedAdmin(false);
      return;
    }
    if (user.email?.toLowerCase() === SUPER_ADMIN_EMAIL) {
      setIsDelegatedAdmin(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'admins', user.uid));
        if (!cancelled) {
          setIsDelegatedAdmin(snap.exists());
        }
      } catch {
        if (!cancelled) setIsDelegatedAdmin(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (isAdmin && openAdminAfterSignInRef.current) {
      openAdminAfterSignInRef.current = false;
      setAdminSubTab('demandes');
      setActiveTab('admin');
    }
  }, [isAdmin, setActiveTab]);

  // Public listener: hosts availability + confirmed public slots
  useEffect(() => {
    const hostsQuery = query(
      collection(db, 'hosts'),
      where('hostId', 'in', ['jean-jacques', 'venicia', 'joel'])
    );
    const unsubHosts = onSnapshot(
      hostsQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const loaded = snapshot.docs.map((d) => d.data() as HostConfig);
          // Merge with defaults in consistent order
          const ordered = DEFAULT_HOSTS.map(
            (def) => loaded.find((item) => item.hostId === def.hostId) || def
          );
          setHosts(ordered);
        }
      },
      (error) => {
        console.warn('Hosts listener warning:', error.message);
      }
    );

    const publicSlotsQuery = query(
      collection(db, 'appointment_status'),
      where('status', '==', 'confirmed')
    );
    const unsubSlots = onSnapshot(
      publicSlotsQuery,
      (snapshot) => {
        setConfirmedPublicSlots(
          snapshot.docs.map((d) => d.data() as PublicAppointmentStatus)
        );
      },
      (error) => {
        console.warn('Public slots listener warning:', error.message);
      }
    );

    return () => {
      unsubHosts();
      unsubSlots();
    };
  }, []);

  // Unified collaborative listeners + Firestore seeding & syncing for everyone
  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    const actorUid = user?.uid || 'collaborateur';

    const syncAndSeed = async () => {
      const guestsReadQuery = query(
        collection(db, 'guests'),
        where('orderNumber', '>=', 1)
      );
      const guestsPublicReadQuery = query(
        collection(db, 'guests_public'),
        where('orderNumber', '>=', 1)
      );
      const hostsReadQuery = query(
        collection(db, 'hosts'),
        where('hostId', 'in', ['jean-jacques', 'venicia', 'joel'])
      );

      let guestsSnap;
      let guestsPublicSnap;
      try {
        [guestsSnap, guestsPublicSnap] = await Promise.all([
          getDocs(guestsReadQuery),
          getDocs(guestsPublicReadQuery),
        ]);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'guests / guests_public');
      }

      const pendingLegacyGuests = loadLegacyPendingGuests();

      try {
        if (guestsSnap.empty) {
          const seedSource =
            pendingLegacyGuests ||
            INITIAL_GUESTS.map((g) => ({
              ...g,
              allowedAdminEmails: [SUPER_ADMIN_EMAIL],
              updatedBy: actorUid,
            }));
          const batch = writeBatch(db);
          for (const g of seedSource) {
            batch.set(doc(db, 'guests', g.id), {
              orderNumber: g.orderNumber,
              fullName: g.fullName,
              nationality: g.nationality,
              passportNumber: g.passportNumber,
              fullCoverage: g.fullCoverage,
              coverageNote: g.coverageNote,
              photoUrl: g.photoUrl,
              checkedIn: g.checkedIn,
              checkedInAt: g.checkedInAt,
              notes: g.notes,
              allowedAdminEmails: [SUPER_ADMIN_EMAIL],
              updatedBy: actorUid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            batch.set(doc(db, 'guests_public', g.id), toPublicGuestPayload(g));
          }
          await batch.commit();
          window.localStorage.removeItem(LEGACY_GUESTS_PENDING_SYNC_KEY);
          window.localStorage.removeItem(LEGACY_GUESTS_STORAGE_KEY);
        } else if (pendingLegacyGuests) {
          const localIds = new Set(pendingLegacyGuests.map((g) => g.id));
          const existingIds = new Set(guestsSnap.docs.map((d) => d.id));
          const batch = writeBatch(db);
          for (const existingDoc of guestsSnap.docs) {
            if (!localIds.has(existingDoc.id)) {
              batch.delete(doc(db, 'guests', existingDoc.id));
              batch.delete(doc(db, 'guests_public', existingDoc.id));
            }
          }
          for (const g of pendingLegacyGuests) {
            if (existingIds.has(g.id)) {
              batch.update(doc(db, 'guests', g.id), {
                fullName: g.fullName,
                nationality: g.nationality,
                passportNumber: g.passportNumber,
                fullCoverage: g.fullCoverage,
                coverageNote: g.coverageNote,
                photoUrl: g.photoUrl,
                notes: g.notes,
                checkedIn: g.checkedIn,
                checkedInAt: g.checkedInAt,
                allowedAdminEmails: [SUPER_ADMIN_EMAIL],
                updatedBy: actorUid,
                updatedAt: serverTimestamp(),
              });
            } else {
              batch.set(doc(db, 'guests', g.id), {
                orderNumber: g.orderNumber,
                fullName: g.fullName,
                nationality: g.nationality,
                passportNumber: g.passportNumber,
                fullCoverage: g.fullCoverage,
                coverageNote: g.coverageNote,
                photoUrl: g.photoUrl,
                checkedIn: g.checkedIn,
                checkedInAt: g.checkedInAt,
                notes: g.notes,
                allowedAdminEmails: [SUPER_ADMIN_EMAIL],
                updatedBy: actorUid,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
            batch.set(doc(db, 'guests_public', g.id), toPublicGuestPayload(g));
          }
          await batch.commit();
          window.localStorage.removeItem(LEGACY_GUESTS_PENDING_SYNC_KEY);
          window.localStorage.removeItem(LEGACY_GUESTS_STORAGE_KEY);
          setLastSavedMessage('Modifications enregistrées et synchronisées dans la base de données.');
        } else if (guestsPublicSnap.empty) {
          const batch = writeBatch(db);
          for (const existingDoc of guestsSnap.docs) {
            const g = existingDoc.data() as Omit<Guest, 'id'>;
            batch.set(doc(db, 'guests_public', existingDoc.id), toPublicGuestPayload(g));
          }
          await batch.commit();
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'guests / guests_public');
      }

      try {
        const hostsSnap = await getDocs(hostsReadQuery);
        if (hostsSnap.empty) {
          const batch = writeBatch(db);
          for (const h of DEFAULT_HOSTS) {
            batch.set(doc(db, 'hosts', h.hostId), {
              hostId: h.hostId,
              name: h.name,
              role: h.role,
              email: h.email,
              googleCalendarId: h.googleCalendarId,
              googleConnectedEmail: h.googleConnectedEmail,
              googleConnected: h.googleConnected,
              workingDays: h.workingDays,
              startHour: h.startHour,
              endHour: h.endHour,
              blockedDates: h.blockedDates,
              updatedAt: serverTimestamp(),
            });
          }
          await batch.commit();
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'hosts');
      }
    };

    let cancelled = false;
    let unsubGuests: (() => void) | undefined;

    syncAndSeed()
      .catch((err) => {
        console.error('Seed/sync failed:', err);
      })
      .finally(() => {
        if (cancelled) return;
        const guestsQuery = query(
          collection(db, 'guests'),
          where('orderNumber', '>=', 1),
          orderBy('orderNumber', 'asc')
        );
        unsubGuests = onSnapshot(
          guestsQuery,
          (snapshot) => {
            const items = snapshot.docs.map((d) => ({
              ...(d.data() as Omit<Guest, 'id'>),
              id: d.id,
            }));
            items.sort((a, b) => a.orderNumber - b.orderNumber);
            setGuests(items);
          },
          (error) => handleFirestoreError(error, OperationType.LIST, 'guests')
        );
      });

    const apptsQuery = query(
      collection(db, 'appointments'),
      where('trackingCode', '>=', 'RDV-')
    );
    const unsubAppts = onSnapshot(
      apptsQuery,
      (snapshot) => {
        const items = snapshot.docs.map((d) => ({
          ...(d.data() as Omit<Appointment, 'id'>),
          id: d.id,
        }));
        items.sort((a, b) => {
          const aSec = (a as { createdAt?: { seconds?: number } }).createdAt?.seconds || 0;
          const bSec = (b as { createdAt?: { seconds?: number } }).createdAt?.seconds || 0;
          if (aSec !== bSec) return bSec - aSec;
          return (b.desiredDate || '').localeCompare(a.desiredDate || '');
        });
        setAppointments(items);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'appointments')
    );

    const notifsQuery = query(
      collection(db, 'notifications'),
      where('recipientRole', '==', 'admin')
    );
    const unsubNotifs = onSnapshot(
      notifsQuery,
      (snapshot) => {
        const items = snapshot.docs.map((d) => ({
          ...(d.data() as Omit<AppNotification, 'id'>),
          id: d.id,
        }));
        items.sort((a, b) => {
          const aSec = (a as { createdAt?: { seconds?: number } }).createdAt?.seconds || 0;
          const bSec = (b as { createdAt?: { seconds?: number } }).createdAt?.seconds || 0;
          return bSec - aSec;
        });
        setNotifications(items);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'notifications')
    );

    let unsubAdmins: (() => void) | undefined;
    if (isSuperAdmin) {
      unsubAdmins = onSnapshot(
        collection(db, 'admins'),
        (snapshot) => {
          setAdminUsers(
            snapshot.docs.map((d) => d.data() as AdminUserRecord)
          );
        },
        (error) => handleFirestoreError(error, OperationType.LIST, 'admins')
      );
    } else {
      setAdminUsers([]);
    }

    return () => {
      cancelled = true;
      if (unsubGuests) unsubGuests();
      unsubAppts();
      unsubNotifs();
      if (unsubAdmins) unsubAdmins();
    };
  }, [isAuthReady, isSuperAdmin, user]);

  const startAdminSignIn = useCallback(async (openOrganizerAfter = false) => {
    setAuthError(null);
    openAdminAfterSignInRef.current = openOrganizerAfter;
    setIsSigningIn(true);
    try {
      await signInWithGoogleAdmin(true);
    } catch (err) {
      openAdminAfterSignInRef.current = false;
      console.error('Sign in failed:', err);
      setAuthError(formatFirebaseAuthError(err));
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const handleAdminSignIn = useCallback(() => {
    void startAdminSignIn(false);
  }, [startAdminSignIn]);

  const handleOrganizerSignInAndOpen = useCallback(() => {
    void startAdminSignIn(true);
  }, [startAdminSignIn]);

  const handleSignOut = useCallback(async () => {
    setAuthError(null);
    openAdminAfterSignInRef.current = false;
    await signOutGoogle();
  }, []);

  const allowedEmailsList = useMemo(() => {
    const emails = new Set<string>([SUPER_ADMIN_EMAIL]);
    hosts.forEach((h) => {
      if (h.email && h.email.includes('@')) emails.add(h.email.toLowerCase());
      if (h.googleConnectedEmail && h.googleConnectedEmail.includes('@')) {
        emails.add(h.googleConnectedEmail.toLowerCase());
      }
    });
    adminUsers.forEach((a) => {
      if (a.email && a.email.includes('@')) emails.add(a.email.toLowerCase());
    });
    return Array.from(emails).slice(0, 10);
  }, [hosts, adminUsers]);

  // Guest check-in toggle (open to everyone)
  const handleToggleGuestCheckIn = async (guest: Guest) => {
    const actorUid = user?.uid || 'collaborateur';
    const nextChecked = !guest.checkedIn;
    const nextTime = nextChecked ? new Date().toISOString() : '';

    await trackAutoSave(
      `${guest.fullName} : marqué comme ${nextChecked ? 'reçu' : 'en attente'}.`,
      async () => {
        try {
          const batch = writeBatch(db);
          batch.update(doc(db, 'guests', guest.id), {
            checkedIn: nextChecked,
            checkedInAt: nextTime,
            updatedBy: actorUid,
            updatedAt: serverTimestamp(),
          });
          batch.set(
            doc(db, 'guests_public', guest.id),
            toPublicGuestPayload({
              ...guest,
              checkedIn: nextChecked,
              checkedInAt: nextTime,
            })
          );
          await batch.commit();
          setLastSavedMessage(
            `${guest.fullName} : statut enregistré automatiquement dans Firebase.`
          );
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `guests/${guest.id}`);
        }
      }
    );
  };

  // Guest details / photo update (open to everyone)
  const handleUpdateGuest = async (
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
  ) => {
    const actorUid = user?.uid || 'collaborateur';
    const currentGuest = guests.find((g) => g.id === guestId);
    if (!currentGuest) {
      throw new Error('Invité introuvable.');
    }
    const merged = { ...currentGuest, ...updates };

    await trackAutoSave(
      `Fiche de ${merged.fullName} mise à jour automatiquement.`,
      async () => {
        try {
          const batch = writeBatch(db);
          batch.update(doc(db, 'guests', guestId), {
            ...updates,
            allowedAdminEmails: allowedEmailsList,
            updatedBy: actorUid,
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db, 'guests_public', guestId), toPublicGuestPayload(merged));
          await batch.commit();
          setLastSavedMessage(
            `Fiche de ${merged.fullName} enregistrée automatiquement dans Firebase.`
          );
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `guests/${guestId}`);
        }
      }
    );
  };

  // Add new guest (open to everyone)
  const handleAddGuest = async (
    newGuest: Omit<Guest, 'id' | 'orderNumber' | 'allowedAdminEmails' | 'updatedBy'>
  ) => {
    const actorUid = user?.uid || 'collaborateur';
    const nextOrder =
      guests.reduce((max, g) => Math.max(max, g.orderNumber), 0) + 1;
    const newId = `guest-${String(nextOrder).padStart(2, '0')}-${Date.now().toString(36)}`;

    await trackAutoSave(
      `${newGuest.fullName} ajouté automatiquement au registre.`,
      async () => {
        try {
          const batch = writeBatch(db);
          batch.set(doc(db, 'guests', newId), {
            orderNumber: nextOrder,
            fullName: newGuest.fullName,
            nationality: newGuest.nationality,
            passportNumber: newGuest.passportNumber,
            fullCoverage: newGuest.fullCoverage,
            coverageNote: newGuest.coverageNote,
            photoUrl: newGuest.photoUrl,
            checkedIn: newGuest.checkedIn,
            checkedInAt: newGuest.checkedInAt,
            notes: newGuest.notes,
            arrivalDate: (newGuest.arrivalDate || '').slice(0, 20),
            arrivalFlight: (newGuest.arrivalFlight || '').slice(0, 120),
            hotelName: (newGuest.hotelName || '').slice(0, 160),
            driverName: (newGuest.driverName || '').slice(0, 160),
            programSchedule: (newGuest.programSchedule || '').slice(0, 300),
            allowedAdminEmails: allowedEmailsList,
            updatedBy: actorUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batch.set(
            doc(db, 'guests_public', newId),
            toPublicGuestPayload({
              orderNumber: nextOrder,
              fullName: newGuest.fullName,
              nationality: newGuest.nationality,
              fullCoverage: newGuest.fullCoverage,
              coverageNote: newGuest.coverageNote,
              photoUrl: newGuest.photoUrl,
              checkedIn: newGuest.checkedIn,
              checkedInAt: newGuest.checkedInAt,
              programSchedule: newGuest.programSchedule,
            })
          );
          await batch.commit();
          setLastSavedMessage('Nouvel invité enregistré automatiquement dans Firebase.');
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `guests/${newId}`);
        }
      }
    );
  };

  // Batch import guests from CSV / Excel (open to everyone)
  const handleImportGuests = async (rows: ImportedGuestRow[]): Promise<number> => {
    const actorUid = user?.uid || 'collaborateur';
    let nextOrder =
      guests.reduce((max, g) => Math.max(max, g.orderNumber), 0) + 1;
    const importedCount = rows.length;

    await trackAutoSave(
      `${importedCount} invité(s) importé(s) et sauvegardé(s) sur Firebase.`,
      async () => {
        try {
          const batch = writeBatch(db);
          for (const row of rows) {
            const newId = `guest-${String(nextOrder).padStart(2, '0')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
            batch.set(doc(db, 'guests', newId), {
              orderNumber: nextOrder,
              fullName: row.fullName,
              nationality: row.nationality,
              passportNumber: row.passportNumber,
              fullCoverage: row.fullCoverage,
              coverageNote: row.coverageNote,
              photoUrl: '',
              checkedIn: false,
              checkedInAt: '',
              notes: '',
              arrivalDate: (row.arrivalDate || '').slice(0, 20),
              arrivalFlight: (row.arrivalFlight || '').slice(0, 120),
              hotelName: (row.hotelName || '').slice(0, 160),
              driverName: (row.driverName || '').slice(0, 160),
              programSchedule: (row.programSchedule || '').slice(0, 300),
              allowedAdminEmails: allowedEmailsList,
              updatedBy: actorUid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            batch.set(
              doc(db, 'guests_public', newId),
              toPublicGuestPayload({
                orderNumber: nextOrder,
                fullName: row.fullName,
                nationality: row.nationality,
                fullCoverage: row.fullCoverage,
                coverageNote: row.coverageNote,
                photoUrl: '',
                checkedIn: false,
                checkedInAt: '',
                programSchedule: row.programSchedule,
              })
            );
            nextOrder++;
          }
          await batch.commit();
          setLastSavedMessage(
            `${importedCount} invité(s) importé(s) et sauvegardé(s) automatiquement dans Firebase.`
          );
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, 'guests/import');
        }
      }
    );
    return importedCount;
  };

  // Delete guest (open to everyone)
  const handleDeleteGuest = async (guest: Guest) => {
    await trackAutoSave(
      `${guest.fullName} supprimé de la liste.`,
      async () => {
        try {
          const batch = writeBatch(db);
          batch.delete(doc(db, 'guests', guest.id));
          batch.delete(doc(db, 'guests_public', guest.id));
          await batch.commit();
          setLastSavedMessage(
            `${guest.fullName} supprimé automatiquement de la base de données.`
          );
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `guests/${guest.id}`);
        }
      }
    );
  };

  // Submit new appointment request (atomic batch: appointment + public status + admin notification)
  const handleSubmitAppointment = async (payload: {
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
  }) => {
    const trackingCode = generateTrackingCode();
    const appointmentId = `appt-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    const notifId = `notif-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    const hostNames = payload.hostIds
      .map((id) => hosts.find((h) => h.hostId === id)?.name || id)
      .join(', ');

    const batch = writeBatch(db);

    batch.set(doc(db, 'appointments', appointmentId), {
      trackingCode,
      requesterUid: user?.uid || 'visitor',
      requesterName: payload.requesterName,
      requesterPhone: payload.requesterPhone,
      requesterEmail: payload.requesterEmail,
      hostIds: payload.hostIds,
      isGroupMeeting: payload.isGroupMeeting,
      reason: payload.reason,
      customReason: payload.customReason,
      desiredDate: payload.desiredDate,
      desiredTime: payload.desiredTime,
      durationMinutes: payload.durationMinutes,
      format: payload.format,
      description: payload.description,
      status: 'pending',
      proposedDate: '',
      proposedTime: '',
      adminComment: '',
      calendarEvents: [],
      allowedAdminEmails: allowedEmailsList,
      reviewedBy: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'appointment_status', trackingCode), {
      trackingCode,
      hostIds: payload.hostIds,
      reason: payload.reason,
      desiredDate: payload.desiredDate,
      desiredTime: payload.desiredTime,
      durationMinutes: payload.durationMinutes,
      format: payload.format,
      status: 'pending',
      proposedDate: '',
      proposedTime: '',
      adminComment: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'notifications', notifId), {
      recipientRole: 'admin',
      hostId: payload.hostIds.length === 1 ? payload.hostIds[0] : 'all',
      trackingCode,
      appointmentId,
      title: `Nouvelle demande de RDV (${trackingCode})`,
      message: `${payload.requesterName} souhaite rencontrer ${hostNames} le ${payload.desiredDate} à ${payload.desiredTime} (${payload.reason}).`,
      type: 'new_request',
      read: false,
      allowedAdminEmails: allowedEmailsList,
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      setRecentTrackingCodes((prev) => [trackingCode, ...prev]);
      setLastSavedMessage(`Inscription enregistrée automatiquement (${trackingCode}).`);
      return { trackingCode };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `appointments/${appointmentId}`);
    }
  };

  // Lookup public tracking status & requester notifications
  const handleLookupStatus = async (trackingCode: string) => {
    try {
      const statusSnap = await getDoc(doc(db, 'appointment_status', trackingCode));
      const statusRecord = statusSnap.exists()
        ? (statusSnap.data() as PublicAppointmentStatus)
        : null;

      let notifs: AppNotification[] = [];
      if (statusRecord) {
        const notifQuery = query(
          collection(db, 'notifications'),
          where('recipientRole', '==', 'requester'),
          where('trackingCode', '==', trackingCode)
        );
        const notifSnap = await getDocs(notifQuery);
        notifs = notifSnap.docs.map((d) => ({
          ...(d.data() as Omit<AppNotification, 'id'>),
          id: d.id,
        }));
      }

      return { statusRecord, notifications: notifs };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `appointment_status/${trackingCode}`);
    }
  };

  // Admin: save host schedule / Google Calendar config
  const handleSaveHostConfig = async (host: HostConfig) => {
    await trackAutoSave(
      `Disponibilités et agenda Google de ${host.name} enregistrés.`,
      async () => {
        try {
          await setDoc(doc(db, 'hosts', host.hostId), {
            hostId: host.hostId,
            name: host.name,
            role: host.role,
            email: host.email || '',
            googleCalendarId: host.googleCalendarId || 'primary',
            googleConnectedEmail: host.googleConnectedEmail || '',
            googleConnected: Boolean(host.googleConnected),
            workingDays: host.workingDays,
            startHour: host.startHour,
            endHour: host.endHour,
            blockedDates: host.blockedDates,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `hosts/${host.hostId}`);
        }
      }
    );
  };

  // Admin: update appointment status & send requester notification
  const handleUpdateAppointmentStatus = async (
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
  ) => {
    const batch = writeBatch(db);
    const apptRef = doc(db, 'appointments', appointment.id);
    const statusRef = doc(db, 'appointment_status', appointment.trackingCode);
    const notifId = `notif-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    const nextDate = updates.desiredDate || appointment.desiredDate;
    const nextTime = updates.desiredTime || appointment.desiredTime;
    const nextDuration = updates.durationMinutes || appointment.durationMinutes;

    batch.update(apptRef, {
      desiredDate: nextDate,
      desiredTime: nextTime,
      durationMinutes: nextDuration,
      status: updates.status,
      proposedDate: updates.proposedDate,
      proposedTime: updates.proposedTime,
      adminComment: updates.adminComment,
      calendarEvents: updates.calendarEvents,
      allowedAdminEmails: allowedEmailsList,
      reviewedBy: user?.email || user?.uid || 'admin',
      updatedAt: serverTimestamp(),
    });

    batch.update(statusRef, {
      desiredDate: nextDate,
      desiredTime: nextTime,
      durationMinutes: nextDuration,
      status: updates.status,
      proposedDate: updates.proposedDate,
      proposedTime: updates.proposedTime,
      adminComment: updates.adminComment,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'notifications', notifId), {
      recipientRole: 'requester',
      hostId: 'requester',
      trackingCode: appointment.trackingCode,
      appointmentId: appointment.id,
      title: requesterNotification.title,
      message: requesterNotification.message,
      type: requesterNotification.type,
      read: false,
      allowedAdminEmails: allowedEmailsList,
      createdAt: serverTimestamp(),
    });

    await trackAutoSave(
      `Décision pour ${appointment.requesterName} (${appointment.trackingCode}) enregistrée.`,
      async () => {
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `appointments/${appointment.id}`);
        }
      }
    );
  };

  const handleMarkNotificationRead = async (notifId: string) => {
    try {
      await updateDoc(doc(db, 'notifications', notifId), { read: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notifications/${notifId}`);
    }
  };

  const handleAddAdminUser = async (record: AdminUserRecord) => {
    try {
      await setDoc(doc(db, 'admins', record.uid), {
        ...record,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `admins/${record.uid}`);
    }
  };

  const handleDeleteAdminUser = async (uid: string) => {
    try {
      await deleteDoc(doc(db, 'admins', uid));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `admins/${uid}`);
    }
  };

  const pendingAdminCount = useMemo(
    () => appointments.filter((a) => a.status === 'pending').length,
    [appointments]
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen flex flex-col text-slate-900">
        <Navbar
          activeTab={activeTab}
          onSelectTab={(tab) => {
            if (tab === 'admin') setAdminSubTab('demandes');
            setActiveTab(tab);
          }}
          pendingAdminCount={pendingAdminCount}
        />

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <PWAInstallButton variant="banner" />

          <ConnectedEcosystemBar
            isAdmin={true}
            isSigningIn={isSigningIn}
            authError={authError}
            onClearAuthError={() => setAuthError(null)}
            currentUserEmail={user?.email || null}
            autoSaveStatus={autoSaveStatus}
            lastSavedAt={lastSavedAt}
            lastSavedLabel={lastSavedLabel}
            isOnline={isOnline}
            guests={guests}
            onAdminSignIn={handleOrganizerSignInAndOpen}
            onOpenOrganizerSpace={() => {
              setAdminSubTab('demandes');
              setActiveTab('admin');
            }}
            onOpenCalendarSection={() => {
              setAdminSubTab('calendars');
              setActiveTab('admin');
            }}
            onOpenWhatsAppShare={() => {
              setActiveTab('guests');
              setShareModalOpen(true);
            }}
          />

          {lastSavedMessage && (
            <div
              role="status"
              className="mb-5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl px-4 py-3 text-sm font-medium flex items-center justify-between gap-3 shadow-xs"
            >
              <span>{lastSavedMessage}</span>
              <button
                type="button"
                onClick={() => setLastSavedMessage(null)}
                className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 shrink-0"
              >
                Fermer
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeTab === 'guests' && (
                <GuestRegistry
                  guests={guests}
                  appointments={appointments}
                  isAdmin={true}
                  isAuthReady={isAuthReady}
                  isSigningIn={isSigningIn}
                  onAdminSignIn={handleAdminSignIn}
                  onToggleCheckIn={handleToggleGuestCheckIn}
                  onUpdateGuest={handleUpdateGuest}
                  onAddGuest={handleAddGuest}
                  onImportGuests={handleImportGuests}
                  onDeleteGuest={handleDeleteGuest}
                  onPlanAppointmentForGuest={(guestName) => {
                    setPrefillRequesterName(guestName);
                    setActiveTab('booking');
                  }}
                  shareModalOpen={shareModalOpen}
                  onSetShareModalOpen={setShareModalOpen}
                />
              )}

              {activeTab === 'booking' && (
                <BookingSection
                  hosts={hosts}
                  confirmedPublicSlots={confirmedPublicSlots}
                  initialRequesterName={prefillRequesterName}
                  onSubmitRequest={handleSubmitAppointment}
                  onGoToTracking={(code) => {
                    setActiveTrackingCode(code);
                    setActiveTab('tracking');
                  }}
                />
              )}

              {activeTab === 'tracking' && (
                <TrackingSection
                  hosts={hosts}
                  initialTrackingCode={activeTrackingCode}
                  recentTrackingCodes={recentTrackingCodes}
                  onLookupStatus={handleLookupStatus}
                />
              )}

              {activeTab === 'admin' && (
                <AdminDashboard
                  currentUserEmail={user?.email || null}
                  currentUserUid={user?.uid || null}
                  isAdmin={true}
                  isSuperAdmin={isSuperAdmin}
                  isSigningIn={isSigningIn}
                  authError={authError}
                  onClearAuthError={() => setAuthError(null)}
                  onAdminSignIn={handleAdminSignIn}
                  onSignOut={handleSignOut}
                  guests={guests}
                  hosts={hosts}
                  appointments={appointments}
                  notifications={notifications}
                  adminUsers={adminUsers}
                  initialSubTab={adminSubTab}
                  onSaveHostConfig={handleSaveHostConfig}
                  onUpdateAppointmentStatus={handleUpdateAppointmentStatus}
                  onMarkNotificationRead={handleMarkNotificationRead}
                  onAddAdminUser={handleAddAdminUser}
                  onDeleteAdminUser={handleDeleteAdminUser}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="border-t border-slate-300/90 bg-white/95 backdrop-blur-xs mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
            <span>
              Bilili BD Festival 2026 · Institut français du Congo
            </span>
            <div className="flex flex-wrap items-center gap-4">
              <PWAInstallButton variant="compact" />
              <button
                type="button"
                onClick={() => setActiveTab('guests')}
                className="hover:text-slate-900 font-medium"
              >
                Liste des invités
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('booking')}
                className="hover:text-slate-900 font-medium"
              >
                Prendre un rendez-vous
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdminSubTab('demandes');
                  setActiveTab('admin');
                }}
                className="hover:text-slate-900 font-medium"
              >
                Espace Organisateur
              </button>
            </div>
          </div>
        </footer>

        <OfflineIndicator />
      </div>
    </MotionConfig>
  );
}
