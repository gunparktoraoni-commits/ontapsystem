/**
 * Canonical in-app destinations referenced by transactional and notification emails.
 * Keep in sync with Next.js app route pages.
 */
export const EMAIL_PORTAL_PATHS = {
  userDashboard: "/user/dashboard",
  /** @deprecated Analytics page removed — maps to BizCard list/dashboard entry. */
  userAnalytics: "/user/bizcard-list",
  userBizcardList: "/user/bizcard-list",
  userAssociate: "/user/associate",
  userOrders: "/user/orders",
  userSettings: "/user/settings",
  userAffiliate: "/user/affiliate",
  userCart: "/user/emarket?tab=cart",
  userEmarket: "/user/emarket",
  userSubscription: "/user/emarket?tab=subscription",
  userSubscriptionTrialPromo: "/user/emarket?tab=subscription&promo=trial-upgrade",
  userInquiry: "/user/inquiry",
  userSignup: "/user/signup",
  userVerifyEmail: "/user/verify-email",
  userForgotPassword: "/user/forgot-password",
  userCalendar: "/user/calendar",
  adminDashboard: "/admin/dashboard",
  /** @deprecated Analytics page removed — maps to BizCard list/dashboard entry. */
  adminAnalytics: "/admin/bizcard-list",
  adminBizcardList: "/admin/bizcard-list",
  adminAssociate: "/admin/associate",
  adminInquiry: "/admin/inquiry-page",
  adminEmarket: "/admin/emarket",
  adminCalendar: "/admin/calendar",
  staffDashboard: "/staff/dashboard",
  staffOrders: "/staff/orders",
  staffProductInquiries: "/staff/product-inquiries",
  staffClients: "/staff/clients",
  staffCalendar: "/staff/calendar",
  staffAnalytics: "/staff/analytics",
  staffAssociate: "/staff/associate",
  staffInquiry: "/staff/inquiry",
  staffEmarket: "/staff/emarket",
  staffVerify: "/staff/verify",
  superadminSupportEscalations: "/superadmin/support-escalations",
  superadminCalendar: "/superadmin/calendar",
  superadminClientList: "/superadmin/client-list",
  devDashboard: "/dev/dashboard",
  devEscalations: "/dev/escalations",
  companyAcceptInvite: "/company/accept-invite",
  feedback: "/feedback/[uuid]",
} as const;

/** Paths used by notification template CTAs (renderNotificationTemplate). */
export const NOTIFICATION_TEMPLATE_PATHS = {
  userDashboard: EMAIL_PORTAL_PATHS.userDashboard,
  userBizcardList: EMAIL_PORTAL_PATHS.userBizcardList,
  userAnalytics: EMAIL_PORTAL_PATHS.userBizcardList,
  userAssociate: EMAIL_PORTAL_PATHS.userAssociate,
  userOrders: EMAIL_PORTAL_PATHS.userOrders,
  userSettings: EMAIL_PORTAL_PATHS.userSettings,
  userAffiliate: EMAIL_PORTAL_PATHS.userAffiliate,
  userCart: EMAIL_PORTAL_PATHS.userCart,
  userEmarket: EMAIL_PORTAL_PATHS.userEmarket,
  userSubscription: EMAIL_PORTAL_PATHS.userSubscription,
  userInquiry: EMAIL_PORTAL_PATHS.userInquiry,
  adminDashboard: EMAIL_PORTAL_PATHS.adminDashboard,
} as const;

/** Default in-app action paths from buildNotificationContent. */
export const NOTIFICATION_EVENT_ACTION_PATHS: Record<string, string> = {
  profile_view: EMAIL_PORTAL_PATHS.userBizcardList,
  contact_download: EMAIL_PORTAL_PATHS.userBizcardList,
  friend_request_sent: EMAIL_PORTAL_PATHS.userAssociate,
  friend_request_accepted: EMAIL_PORTAL_PATHS.userAssociate,
  inquiry_sent: EMAIL_PORTAL_PATHS.userInquiry,
  connection_added: EMAIL_PORTAL_PATHS.userAssociate,
  system_update: EMAIL_PORTAL_PATHS.userDashboard,
  subscription_expiring: EMAIL_PORTAL_PATHS.userSubscription,
  support_message_received: EMAIL_PORTAL_PATHS.userDashboard + "?openSupport=1",
  support_escalated: EMAIL_PORTAL_PATHS.userDashboard + "?openSupport=1",
  support_resolved: EMAIL_PORTAL_PATHS.userDashboard + "?openSupport=1",
  direct_message_received: EMAIL_PORTAL_PATHS.userAssociate,
  client_order_placed: EMAIL_PORTAL_PATHS.staffOrders,
  product_inquiry_received: EMAIL_PORTAL_PATHS.staffProductInquiries,
  client_assigned: EMAIL_PORTAL_PATHS.staffClients,
  calendar_event_shared: EMAIL_PORTAL_PATHS.userCalendar,
  calendar_event_reminder: EMAIL_PORTAL_PATHS.userCalendar,
  calendar_event_attendance: EMAIL_PORTAL_PATHS.userCalendar,
};

/** Branded shell footer and transactional email CTAs in server/lib/email.ts. */
export const TRANSACTIONAL_EMAIL_PATHS = [
  EMAIL_PORTAL_PATHS.userSettings,
  EMAIL_PORTAL_PATHS.userDashboard,
  EMAIL_PORTAL_PATHS.userCart,
  EMAIL_PORTAL_PATHS.userEmarket,
  EMAIL_PORTAL_PATHS.userSubscription,
  EMAIL_PORTAL_PATHS.userOrders,
  EMAIL_PORTAL_PATHS.userInquiry,
  EMAIL_PORTAL_PATHS.userSubscriptionTrialPromo,
  EMAIL_PORTAL_PATHS.userBizcardList,
  EMAIL_PORTAL_PATHS.userForgotPassword,
  EMAIL_PORTAL_PATHS.userSignup,
] as const;

/** Invite / onboarding email button paths (relative portion). */
export const INVITE_EMAIL_PATHS = [
  EMAIL_PORTAL_PATHS.staffVerify,
  EMAIL_PORTAL_PATHS.companyAcceptInvite,
  EMAIL_PORTAL_PATHS.adminDashboard,
  EMAIL_PORTAL_PATHS.userDashboard,
] as const;
