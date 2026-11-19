import { initializeApp } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  User,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { HostId } from '../types';

export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

const app = initializeApp(firebaseConfig);

function createFirestoreInstance() {
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return initializeFirestore(
      app,
      { localCache: memoryLocalCache() },
      firebaseConfig.firestoreDatabaseId
    );
  }
}

export const db = createFirestoreInstance();
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Firestore client is offline. Please verify Firebase configuration.');
    }
    return false;
  }
}

// In-memory cache ONLY for Google Calendar OAuth tokens (never localStorage/sessionStorage)
let adminAccessToken: string | null = null;
const hostCalendarTokens: Partial<Record<HostId, { accessToken: string; email: string }>> = {};

export function clearMemoryTokens() {
  adminAccessToken = null;
  delete hostCalendarTokens['jean-jacques'];
  delete hostCalendarTokens['venicia'];
  delete hostCalendarTokens['joel'];
}

function getFirebaseErrorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return String((err as { code?: unknown }).code || '');
  }
  return '';
}

function isTopLevelWindow(): boolean {
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

export function formatFirebaseAuthError(err: unknown): string {
  const code = getFirebaseErrorCode(err);
  const host =
    typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname
      : 'ce domaine';

  switch (code) {
    case 'auth/unauthorized-domain':
      return `Le domaine "${host}" n’est pas encore autorisé dans Firebase Authentication. Dans la console Firebase → Authentication → Paramètres → Domaines autorisés, ajoutez "${host}".`;
    case 'auth/popup-blocked':
      return 'La fenêtre de connexion Google a été bloquée par le navigateur. Autorisez les fenêtres contextuelles (pop-ups) ou réessayez.';
    case 'auth/popup-closed-by-user':
      return 'La fenêtre de connexion Google a été fermée avant la validation.';
    case 'auth/cancelled-popup-request':
      return 'Une demande de connexion Google est déjà en cours.';
    case 'auth/network-request-failed':
      return 'Connexion réseau impossible pour contacter Google Authentication. Vérifiez votre connexion Internet.';
    case 'auth/operation-not-allowed':
      return 'La connexion Google est désactivée dans les paramètres Firebase Authentication.';
    default:
      if (err instanceof Error && err.message) {
        return err.message;
      }
      return 'Impossible de finaliser la connexion Google Organisateur.';
  }
}

export function initFirebaseAuth(
  onUserChange: (user: User | null) => void,
  onAuthError?: (message: string) => void
): () => void {
  // Handle returning OAuth redirect sessions (used on mobile / Netlify when popups are blocked)
  getRedirectResult(auth)
    .then((result) => {
      if (result) {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
          adminAccessToken = credential.accessToken;
        }
      }
    })
    .catch((err) => {
      const code = getFirebaseErrorCode(err);
      if (code && code !== 'auth/no-auth-event') {
        onAuthError?.(formatFirebaseAuthError(err));
      }
    });

  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      clearMemoryTokens();
    }
    onUserChange(user);
  });
}

function createGoogleProvider(includeCalendarScopes: boolean): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  if (includeCalendarScopes) {
    CALENDAR_SCOPES.forEach((scope) => provider.addScope(scope));
  }
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

export async function signInWithGoogleAdmin(includeCalendarScopes = true): Promise<{
  user: User | null;
  accessToken: string | null;
  redirectStarted?: boolean;
}> {
  const provider = createGoogleProvider(includeCalendarScopes);
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      adminAccessToken = credential.accessToken;
    }
    return {
      user: result.user,
      accessToken: credential?.accessToken || null,
    };
  } catch (err) {
    const code = getFirebaseErrorCode(err);

    // On standalone hosted domains (e.g. Netlify mobile/Safari), redirect cleanly if popup is blocked
    if (code === 'auth/popup-blocked' && isTopLevelWindow()) {
      await signInWithRedirect(auth, provider);
      return { user: null, accessToken: null, redirectStarted: true };
    }

    // If Calendar OAuth scope consent fails for an external issue (not user cancel / domain error), retry basic Organizer login
    const skipBasicRetryCodes = new Set([
      'auth/unauthorized-domain',
      'auth/popup-closed-by-user',
      'auth/cancelled-popup-request',
      'auth/network-request-failed',
      'auth/operation-not-allowed',
      'auth/popup-blocked',
    ]);
    if (includeCalendarScopes && !skipBasicRetryCodes.has(code)) {
      const basicProvider = createGoogleProvider(false);
      const basicResult = await signInWithPopup(auth, basicProvider);
      return {
        user: basicResult.user,
        accessToken: null,
      };
    }

    throw err;
  }
}

export async function connectHostGoogleAccount(hostId: HostId): Promise<{
  email: string;
  accessToken: string;
}> {
  const provider = createGoogleProvider(true);

  // Use signInWithPopup to obtain a fresh OAuth access token for the selected host's Google account
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error("Impossible d'obtenir le jeton d'accès Google Agenda.");
  }
  const email = result.user.email || '';
  hostCalendarTokens[hostId] = {
    accessToken: credential.accessToken,
    email,
  };
  adminAccessToken = credential.accessToken;
  return {
    email,
    accessToken: credential.accessToken,
  };
}

export function getHostAccessToken(hostId: HostId): string | null {
  return hostCalendarTokens[hostId]?.accessToken || null;
}

export function getAdminAccessToken(): string | null {
  return adminAccessToken;
}

export function getHostConnectedSessionEmail(hostId: HostId): string | null {
  return hostCalendarTokens[hostId]?.email || null;
}

export async function signOutGoogle(): Promise<void> {
  clearMemoryTokens();
  await signOut(auth);
}
