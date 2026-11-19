import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
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

export function initFirebaseAuth(
  onUserChange: (user: User | null) => void
): () => void {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      clearMemoryTokens();
    }
    onUserChange(user);
  });
}

export async function signInWithGoogleAdmin(includeCalendarScopes = true): Promise<{
  user: User;
  accessToken: string | null;
}> {
  const provider = new GoogleAuthProvider();
  if (includeCalendarScopes) {
    CALENDAR_SCOPES.forEach((scope) => provider.addScope(scope));
  }
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    adminAccessToken = credential.accessToken;
  }
  return {
    user: result.user,
    accessToken: credential?.accessToken || null,
  };
}

export async function connectHostGoogleAccount(hostId: HostId): Promise<{
  email: string;
  accessToken: string;
}> {
  const provider = new GoogleAuthProvider();
  CALENDAR_SCOPES.forEach((scope) => provider.addScope(scope));
  provider.setCustomParameters({ prompt: 'select_account' });

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
