import Ionicons from '@expo/vector-icons/Ionicons';
import { MOBILE_MODULE_BY_KEY, type MobileModuleKey } from '@dealflow/types';
import { Redirect, Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { BrandMark, Loading } from '../../src/components/ui';
import { t, tMaybe } from '../../src/lib/i18n';
import { MODULE_ICON } from '../../src/lib/modules';
import { useSession, useTheme } from '../../src/lib/session';

/**
 * Keeps a screen out of the tab bar but reachable from More. (`href: null` would also make the route unreachable in
 * this version of Expo Router.)
 */
const NOT_A_TAB = { tabBarButton: () => null, tabBarItemStyle: { display: 'none' } } as const;

const MODULE_ROUTES: MobileModuleKey[] = ['dashboard', 'companies', 'contacts', 'follow_ups', 'tasks', 'deals', 'targets', 'reports', 'chat', 'notifications', 'profile'];

/**
 * The bottom tabs come from the published Mobile Configuration for this person's level (ADR 0072, M2): up to five
 * tabs in the order the Super Workspace chose, then "More" for the rest, Help and
 * the person's questions to support. Modules the person may not use have no tab
 * and no route. There is deliberately no "Recent" list anywhere in the app.
 */
export default function AppLayout() {
  const s = useSession();
  const th = useTheme();
  // While the stored session loads, wait here so a link into the app keeps its place.
  if (s.status === 'starting') return <Loading />;
  if (s.status !== 'signedIn') return <Redirect href="/" />;
  const { tabs, modules, branding } = s.config;
  const allowed = new Set(modules.map((m) => m.key));
  const order = [...tabs, ...MODULE_ROUTES.filter((k) => !tabs.includes(k))];

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: th.primary },
        headerTintColor: th.onPrimary,
        headerTitleStyle: { fontWeight: '600' },
        tabBarActiveTintColor: th.primary,
        tabBarInactiveTintColor: th.muted,
        tabBarStyle: { backgroundColor: th.card, borderTopColor: th.border },
        sceneStyle: { backgroundColor: th.background },
      }}
    >
      {order.map((key) => (
        <Tabs.Screen
          key={key}
          name={key}
          options={{
            // Not a tab: reachable from More if the person may use it (the screen sends anyone else home).
            ...(tabs.includes(key) && allowed.has(key) ? {} : NOT_A_TAB),
            title: tMaybe(MOBILE_MODULE_BY_KEY[key].label),
            tabBarIcon: ({ focused, color, size }) => <Ionicons aria-hidden name={focused ? MODULE_ICON[key].on : MODULE_ICON[key].off} color={color as string} size={size} />,
            ...(key === 'dashboard'
              ? {
                  headerTitle: () => (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <BrandMark name={branding.appName} logo={branding.logoDataUrl} size={28} color={th.onPrimary} />
                      <Text style={{ color: th.onPrimary, fontSize: 17, fontWeight: '600' }}>{branding.appName}</Text>
                    </View>
                  ),
                }
              : {}),
          }}
        />
      ))}
      <Tabs.Screen
        name="more"
        options={{
          title: t('More'),
          tabBarIcon: ({ focused, color, size }) => <Ionicons aria-hidden name={focused ? 'menu' : 'menu-outline'} color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen name="help" options={{ ...NOT_A_TAB, headerShown: false, title: t('Help') }} />
    </Tabs>
  );
}
