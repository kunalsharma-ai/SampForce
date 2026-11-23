import type { MobileModuleKey } from '@dealflow/types';
import type { IconName } from '../components/ui';

/** The tab bar icon for each module (Ionicons, bundled with the app). */
export const MODULE_ICON: Record<MobileModuleKey, { on: IconName; off: IconName }> = {
  dashboard: { on: 'home', off: 'home-outline' },
  companies: { on: 'business', off: 'business-outline' },
  contacts: { on: 'people', off: 'people-outline' },
  follow_ups: { on: 'call', off: 'call-outline' },
  tasks: { on: 'checkbox', off: 'checkbox-outline' },
  deals: { on: 'briefcase', off: 'briefcase-outline' },
  targets: { on: 'flag', off: 'flag-outline' },
  reports: { on: 'bar-chart', off: 'bar-chart-outline' },
  chat: { on: 'chatbubbles', off: 'chatbubbles-outline' },
  notifications: { on: 'notifications', off: 'notifications-outline' },
  profile: { on: 'person-circle', off: 'person-circle-outline' },
};
