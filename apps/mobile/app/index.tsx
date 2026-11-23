import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { Loading } from '../src/components/ui';
import { useSession, useTheme } from '../src/lib/session';

/** Sends the app where the session says: sign-in, the stopped screen, or the first tab. */
export default function Index() {
  const s = useSession();
  const th = useTheme();
  if (s.status === 'starting')
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: th.background }}>
        <Loading />
      </View>
    );
  if (s.status === 'signedOut' || s.status === 'mfa') return <Redirect href="/sign-in" />;
  if (s.status === 'blocked' || s.status === 'unreachable') return <Redirect href="/status" />;
  return <Redirect href={`/${s.config.tabs[0] ?? 'dashboard'}`} />;
}
