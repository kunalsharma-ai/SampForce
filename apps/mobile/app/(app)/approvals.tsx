import type { TeamApprovalOverview, TeamApprovalRow } from '@dealflow/types';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApprovalCard } from '../../src/components/approvals';
import { Body, ErrorNote, Loading, Screen } from '../../src/components/ui';
import { t } from '../../src/lib/i18n';
import { useApi, useTheme } from '../../src/lib/session';

type Box = 'decide' | 'mine';

/**
 * Approvals on the phone (ADR 0098): requests waiting for this person's decision (Super and Manager Workspaces) and
 * their own requests, which they finish here once approved. Deleted items and the rules stay on the web.
 */
export default function Approvals() {
  const th = useTheme();
  const params = useLocalSearchParams<{ request?: string }>();
  const overview = useApi<TeamApprovalOverview>('/team-approvals/overview');
  const [box, setBox] = useState<Box | null>(null);
  const shown: Box = box ?? (overview.data?.decides && overview.data.counts.toDecide > 0 ? 'decide' : 'mine');
  const list = useApi<TeamApprovalRow[]>(overview.data ? `/team-approvals?box=${shown}&status=${shown === 'decide' ? 'PENDING' : 'ANY'}` : null);
  const one = useApi<TeamApprovalRow>(params.request ? `/team-approvals/${encodeURIComponent(params.request)}` : null);
  const reloadAll = useCallback(() => {
    overview.reload();
    list.reload();
    one.reload();
  }, [overview.reload, list.reload, one.reload]); // eslint-disable-line react-hooks/exhaustive-deps -- the reload functions are stable
  useFocusEffect(useCallback(() => reloadAll(), [reloadAll]));

  const tabs: { key: Box; label: string; count: number }[] = [
    ...(overview.data?.decides ? [{ key: 'decide' as const, label: t('Waiting for you'), count: overview.data.counts.toDecide }] : []),
    { key: 'mine', label: t('My requests'), count: (overview.data?.counts.minePending ?? 0) + (overview.data?.counts.mineReady ?? 0) },
  ];
  const rows = (list.data ?? []).filter((r) => r.id !== one.data?.id);

  return (
    <Screen refreshing={list.loading && !!list.data} onRefresh={reloadAll}>
      {overview.error && !overview.data ? <ErrorNote message={overview.error} onRetry={overview.reload} /> : null}
      {overview.data ? (
        <Body muted>
          {overview.data.needsApprovalToDelete
            ? t('Deletes in your workspace need your manager’s approval.')
            : overview.data.level === 'SUPER'
              ? t('You delete directly and can decide every request.')
              : overview.data.decides
                ? t('You delete directly. Your team’s requests come to you.')
                : t('Your workspace deletes without asking.')}
        </Body>
      ) : null}
      {one.data ? <ApprovalCard row={one.data} onChanged={reloadAll} /> : null}
      {tabs.length > 1 ? (
        <View style={styles.tabs} accessibilityRole="tablist">
          {tabs.map((x) => (
            <Pressable
              key={x.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: shown === x.key }}
              onPress={() => setBox(x.key)}
              style={[styles.tab, { borderColor: th.border, backgroundColor: shown === x.key ? th.primary : th.card }]}
            >
              <Text style={{ color: shown === x.key ? th.onPrimary : th.text, fontWeight: '600' }}>
                {x.label}
                {x.count ? ` (${x.count})` : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {list.error && !list.data ? <ErrorNote message={list.error} onRetry={list.reload} /> : null}
      {!list.data && (list.loading || overview.loading) ? <Loading /> : null}
      {list.data && !rows.length ? <Body muted>{shown === 'decide' ? t('Nothing is waiting for your decision.') : t('You have not asked for anything yet.')}</Body> : null}
      {rows.map((r) => (
        <ApprovalCard key={r.id} row={r} onChanged={reloadAll} />
      ))}
      <Body muted style={{ fontSize: 13 }}>
        {t('Deleted items and the approval rules are on the web.')}
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
});
