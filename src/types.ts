export type HostId = 'jean-jacques' | 'venicia' | 'joel';

export type AppointmentReason =
  | "Moment d'échange"
  | 'Discussion personnelle'
  | 'Accompagnement'
  | 'Travail spécifique'
  | 'Réunion de projet'
  | 'Autre';

export type AppointmentFormat = 'présentiel' | 'en ligne';

export type AppointmentStatus = 'pending' | 'confirmed' | 'declined_or_reschedule';

export interface CalendarEventRef {
  hostId: HostId;
  hostName: string;
  calendarId: string;
  eventId: string;
  htmlLink: string;
}

export interface Guest {
  id: string;
  orderNumber: number;
  fullName: string;
  nationality: string;
  passportNumber: string;
  fullCoverage: boolean;
  coverageNote: string;
  photoUrl: string;
  checkedIn: boolean;
  checkedInAt: string;
  notes: string;
  arrivalDate?: string;
  arrivalFlight?: string;
  hotelName?: string;
  driverName?: string;
  programSchedule?: string;
  allowedAdminEmails: string[];
  updatedBy: string;
}

export interface HostConfig {
  hostId: HostId;
  name: string;
  role: string;
  email: string;
  googleCalendarId: string;
  googleConnectedEmail: string;
  googleConnected: boolean;
  workingDays: string[];
  startHour: string;
  endHour: string;
  blockedDates: string[];
}

export interface Appointment {
  id: string;
  trackingCode: string;
  requesterUid: string;
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
  status: AppointmentStatus;
  proposedDate: string;
  proposedTime: string;
  adminComment: string;
  calendarEvents: CalendarEventRef[];
  allowedAdminEmails: string[];
  reviewedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PublicAppointmentStatus {
  trackingCode: string;
  hostIds: HostId[];
  reason: string;
  desiredDate: string;
  desiredTime: string;
  durationMinutes: number;
  format: AppointmentFormat;
  status: AppointmentStatus;
  proposedDate: string;
  proposedTime: string;
  adminComment: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AppNotification {
  id: string;
  recipientRole: 'admin' | 'requester';
  hostId: string;
  trackingCode: string;
  appointmentId: string;
  title: string;
  message: string;
  type: 'new_request' | 'confirmed' | 'rescheduled' | 'declined' | 'calendar_sync';
  read: boolean;
  allowedAdminEmails: string[];
  createdAt?: unknown;
}

export interface AdminUserRecord {
  uid: string;
  email: string;
  displayName: string;
  role: 'super_admin' | 'host_admin';
  hostId: 'all' | HostId;
}

export type ActiveTab = 'guests' | 'booking' | 'tracking' | 'admin';
