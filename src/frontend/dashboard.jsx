// "Assumption Health" - a full-page dashboard: is each release safe to ship, and the health of every assumption.
// UI Kit components only. The release VERDICT is computed on the server by fixed rules (lib/release.js), never by AI.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, DynamicTable, EmptyState, Heading, Inline, Link, Lozenge, SectionMessage, Select, Spinner, Stack, Strong,
  Tab, TabList, TabPanel, Tabs, Text, Textfield, User,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { summarize, filterAssumptions } from '../lib/dashboard.js';
import { STATUS_APPEARANCE, STATUS_LABEL } from '../lib/assess.js';
import { attentionBanner, releaseBanner } from '../lib/format.js';

const APPEARANCE = STATUS_APPEARANCE;
const VERDICT_APPEARANCE = { ready: 'success', 'at-risk': 'moved', blocked: 'removed', unknown: 'default' };
const VERDICT_LABEL = { ready: 'Ready', 'at-risk': 'At risk', blocked: 'Blocked', unknown: 'Unknown' };

const STATUS_OPTIONS = [
  { label: 'All statuses', value: 'all' },
  { label: 'Needs attention', value: 'attention' },
  { label: 'Contradicted', value: 'contradicted' },
  { label: 'At risk', value: 'at-risk' },
  { label: 'Healthy', value: 'healthy' },
  { label: 'Unverified', value: 'unverified' },
  { label: 'Stale', value: 'stale' },
];
const SORT_OPTIONS = [
  { label: 'Needs attention first', value: 'priority' },
  { label: 'Most recently checked', value: 'checked' },
  { label: 'Assumption (A to Z)', value: 'text' },
];

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '-');
const fmtDay = (iso) => (iso ? String(iso).slice(0, 10) : '-');

// A summary tile: a big number with a label.
const Tile = ({ label, value, appearance }) => (
  <Box padding="space.150">
    <Stack space="space.050">
      <Text>{label}</Text>
      <Heading size="large">{value}</Heading>
      {appearance && <Lozenge appearance={appearance}>{label}</Lozenge>}
    </Stack>
  </Box>
);

// ---------------------------------------------------------------------------------------------------
// Releases: "is it safe to ship this?"
// ---------------------------------------------------------------------------------------------------
const ReleasesTab = () => {
  const [list, setList] = useState(null);        // { releases, unlinked, hiddenCount }
  const [detail, setDetail] = useState(null);    // one release in detail
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reasonText, setReasonText] = useState({}); // per assumption: the typed reason
  const [daysText, setDaysText] = useState({});     // per assumption: the typed number of days

  const loadList = () => invoke('getReleases').then(setList).catch((e) => setError(e.message || 'Could not load releases.'));
  useEffect(() => { loadList(); }, []);

  const open = async (name) => {
    setError(null); setNotice(null);
    try {
      setDetail(await invoke('getRelease', { release: name }));
    } catch (e) {
      setError(e.message || 'Could not load that release.');
    }
  };

  // Runs an action (accept / revoke) and then refreshes both the detail and the list.
  const act = async (fn, okMessage) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await fn();
      if (r.error) throw new Error(r.error);
      setNotice(okMessage);
      await open(detail.release);
      await loadList();
    } catch (e) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  const accept = (a) => act(
    () => invoke('acceptRisk', { id: a.id, reason: reasonText[a.id], days: daysText[a.id] || '14' }),
    'Risk accepted and recorded in the audit log.',
  );
  const revoke = (a) => act(() => invoke('revokeRisk', { id: a.id }), 'The accepted risk was revoked.');

  if (error && !list) return <SectionMessage appearance="error" title="Could not load releases"><Text>{error}</Text></SectionMessage>;
  if (!list) return <Spinner label="Loading releases" />;

  const head = { cells: ['Release', 'Verdict', 'Blocking', 'At risk', 'OK', 'Assumptions'].map((c) => ({ key: c, content: c })) };
  const rows = list.releases.map((r) => ({
    key: r.name,
    cells: [
      { key: 'name', content: <Button appearance="link" onClick={() => open(r.name)}>{r.name}</Button> },
      { key: 'verdict', content: <Lozenge appearance={VERDICT_APPEARANCE[r.verdict]} isBold>{VERDICT_LABEL[r.verdict]}</Lozenge> },
      { key: 'blocking', content: String(r.counts.blockers) },
      { key: 'risk', content: String(r.counts.risks) },
      { key: 'ok', content: String(r.counts.ok) },
      { key: 'total', content: String(r.counts.total) },
    ],
  }));

  return (
    <Stack space="space.200">
      <Text>Each assumption can be linked to a release. A release is Blocked while a critical assumption linked to it is contradicted and nobody has accepted the risk. It is At risk if something needs investigation, is unverified or stale, or carries an accepted risk. It is Ready only when everything linked to it is healthy and recently checked. The verdict comes from fixed rules, not from AI.</Text>
      {error && <SectionMessage appearance="error" title="Something went wrong"><Text>{error}</Text></SectionMessage>}
      {notice && <SectionMessage appearance="success"><Text>{notice}</Text></SectionMessage>}

      {list.releases.length === 0 ? (
        <EmptyState
          header="No releases yet"
          description="Link assumptions to a release when you add them: open a Confluence page, click Hindsight under its title, then Add assumption and fill in Release."
        />
      ) : (
        <DynamicTable head={head} rows={rows} rowsPerPage={10} />
      )}
      {list.unlinked > 0 && <Text>{list.unlinked} assumption(s) are not linked to any release, so they do not count towards a release verdict.</Text>}

      {detail && (
        <Box padding="space.200">
          <Stack space="space.150">
            {(() => {
              const b = releaseBanner(detail.release, detail.verdict, detail.sentence);
              return <SectionMessage appearance={b.appearance} title={b.title}><Text>{b.text}</Text></SectionMessage>;
            })()}

            {detail.reasons.map((r) => (
              <Stack key={r.assumptionId} space="space.050">
                <Inline space="space.100" alignBlock="center">
                  <Lozenge appearance={r.level === 'blocker' ? 'removed' : r.level === 'risk' ? 'moved' : 'default'} isBold>{r.level === 'blocker' ? 'Blocks release' : r.level === 'risk' ? 'Risk' : 'Note'}</Lozenge>
                  <Text><Strong>{r.text}</Strong></Text>
                </Inline>
                <Text>{r.why}</Text>
                <Text>Required: {r.required}</Text>
              </Stack>
            ))}

            <Heading size="small">Assumptions behind this release</Heading>
            {detail.assumptions.map((a) => (
              <Box key={a.id} padding="space.100">
                <Stack space="space.100">
                  <Inline space="space.100" alignBlock="center">
                    <Lozenge appearance={APPEARANCE[a.status]} isBold>{STATUS_LABEL[a.status]}</Lozenge>
                    <Text>{a.text}</Text>
                    {a.count !== null && <Text>({a.count} of {a.threshold})</Text>}
                  </Inline>
                  {a.riskAccepted && (
                    <Inline space="space.100" alignBlock="center">
                      <Lozenge appearance="moved">Risk accepted</Lozenge>
                      {a.riskAccepted.by && <User accountId={a.riskAccepted.by} />}
                      <Text>until {fmtDay(a.riskAccepted.until)}: "{a.riskAccepted.reason}"</Text>
                      {detail.canAcceptRisk && (busy ? <Spinner size="small" /> : <Button appearance="subtle" onClick={() => revoke(a)}>Revoke</Button>)}
                    </Inline>
                  )}
                  {(a.status === 'contradicted' || a.status === 'at-risk') && !a.riskAccepted && detail.canAcceptRisk && (
                    <Inline space="space.100" alignBlock="center">
                      <Textfield placeholder="Why is it acceptable to ship anyway? (at least 10 characters)" value={reasonText[a.id] || ''} onChange={(e) => setReasonText({ ...reasonText, [a.id]: e.target.value })} />
                      <Textfield width="xsmall" placeholder="Days" value={daysText[a.id] || '14'} onChange={(e) => setDaysText({ ...daysText, [a.id]: e.target.value })} />
                      {busy ? <Spinner size="small" /> : <Button onClick={() => accept(a)}>Accept risk</Button>}
                    </Inline>
                  )}
                  {(a.status === 'contradicted' || a.status === 'at-risk') && !a.riskAccepted && !detail.canAcceptRisk && (
                    <Text>Only a site administrator can accept this risk.</Text>
                  )}
                </Stack>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
};

// ---------------------------------------------------------------------------------------------------
// One assumption in detail: why it has its status, and the Jira issues behind it. A person can review each issue, which is how
// related evidence becomes a confirmed contradiction (or a false match is removed). Reviews are recorded in the audit log.
// ---------------------------------------------------------------------------------------------------
const REVIEW_LABEL = { contradicts: 'Contradicts', supports: 'Supports', unrelated: 'Unrelated' };
const REVIEW_APPEARANCE = { contradicts: 'removed', supports: 'success', unrelated: 'default' };

const AssumptionDetail = ({ a, siteUrl, onChanged, onClose }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const call = async (name, payload) => {
    setBusy(true); setError(null);
    try {
      const r = await invoke(name, { id: a.id, ...payload });
      if (r.error) throw new Error(r.error);
      await onChanged();
    } catch (e) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const counts = a.counts || {};
  return (
    <Box padding="space.200">
      <Stack space="space.150">
        <Inline space="space.100" alignBlock="center">
          <Heading size="medium">{a.text}</Heading>
          <Lozenge appearance={APPEARANCE[a.status]} isBold>{STATUS_LABEL[a.status]}</Lozenge>
        </Inline>
        {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
        {a.reasons.map((r) => <Text key={r}>{r}</Text>)}
        <Text>
          {a.mode === 'direct'
            ? 'How it is judged: a structured query you defined. Reaching the threshold counts as a contradiction.'
            : 'How it is judged: a keyword search finds related issues. Reaching the threshold means "investigate"; a person confirms a contradiction below.'}
        </Text>
        <Text>
          Matching issues: {counts.matched ?? '-'} | marked unrelated: {counts.dismissed ?? 0} | confirmed contradicting: {counts.confirmed ?? 0} | threshold: {counts.threshold ?? a.threshold} within {a.windowDays} days.
        </Text>
        <Text>
          Last checked: {fmt(a.lastCheckedAt)} | Release: {a.releaseKey || 'none'} (the release depends on it as: {a.severity}) | Ticket: {a.ticketKey ? `${a.ticketKey} (${a.ticketStatus})` : 'none'}
        </Text>

        <Heading size="small">Matching Jira issues</Heading>
        {a.evidence.length === 0 && <Text>No matching issues in the time window.</Text>}
        {a.evidence.map((e) => (
          <Inline key={e.key} space="space.100" alignBlock="center">
            <Link href={`${siteUrl}/browse/${e.key}`} openNewTab>{e.key}</Link>
            <Text>{e.summary}</Text>
            {a.evidenceReviews[e.key] && <Lozenge appearance={REVIEW_APPEARANCE[a.evidenceReviews[e.key]]}>{REVIEW_LABEL[a.evidenceReviews[e.key]]}</Lozenge>}
            {busy ? <Spinner size="small" /> : (
              <>
                <Button appearance="subtle" onClick={() => call('reviewEvidence', { issueKey: e.key, review: 'contradicts' })}>Contradicts</Button>
                <Button appearance="subtle" onClick={() => call('reviewEvidence', { issueKey: e.key, review: 'unrelated' })}>Unrelated</Button>
                {a.evidenceReviews[e.key] && <Button appearance="subtle" onClick={() => call('reviewEvidence', { issueKey: e.key, review: 'clear' })}>Clear</Button>}
              </>
            )}
          </Inline>
        ))}

        {a.releaseKey && (
          <Inline space="space.100" alignBlock="center">
            <Text>How much does {a.releaseKey} depend on this assumption?</Text>
            {busy ? <Spinner size="small" /> : (
              <>
                <Button appearance={a.severity === 'critical' ? 'primary' : 'default'} onClick={() => call('setSeverity', { severity: 'critical' })}>Critical</Button>
                <Button appearance={a.severity === 'standard' ? 'primary' : 'default'} onClick={() => call('setSeverity', { severity: 'standard' })}>Standard</Button>
              </>
            )}
          </Inline>
        )}
        {a.impactNote && <Text>{a.impactNote}</Text>}
        <Inline><Button onClick={onClose}>Close</Button></Inline>
      </Stack>
    </Box>
  );
};

// ---------------------------------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------------------------------
const AuditTab = () => {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    invoke('getAudit').then((r) => setEntries(r.entries)).catch((e) => setError(e.message));
  }, []);
  if (error) return <SectionMessage appearance="error" title="Could not load the audit log"><Text>{error}</Text></SectionMessage>;
  if (!entries) return <Spinner label="Loading audit log" />;
  if (entries.length === 0) {
    return <EmptyState header="Nothing logged yet" description="Adding, deleting or checking an assumption will show up here." />;
  }
  const rows = entries.map((e, i) => ({
    key: `a${i}`,
    cells: [
      { key: 'when', content: fmt(e.at) },
      { key: 'type', content: <Lozenge>{e.type}</Lozenge> },
      // Real accounts show as a name; the scheduler/app show as plain text.
      { key: 'who', content: /^[0-9a-f]+:|^\d+:/.test(e.actor) || e.actor.length > 20 ? <User accountId={e.actor} /> : e.actor },
      { key: 'what', content: e.text || '-' },
      { key: 'detail', content: e.detail || '-' },
    ],
  }));
  const head = { cells: ['When', 'Event', 'Who', 'Assumption', 'Detail'].map((c) => ({ key: c, content: c })) };
  return <DynamicTable head={head} rows={rows} rowsPerPage={10} />;
};

// ---------------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------------
const App = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(STATUS_OPTIONS[0]);
  const [sort, setSort] = useState(SORT_OPTIONS[0]);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null); // the assumption whose evidence is open
  const [demo, setDemo] = useState({ exists: false });   // is demo mode on?
  const [working, setWorking] = useState(null);         // 'create' | 'remove' | null
  const [message, setMessage] = useState(null);         // result of turning demo mode on or off
  const [version, setVersion] = useState(0);            // bumps when data changes, so the Releases tab reloads

  const reload = () => invoke('getDashboard').then(setData).catch((e) => setError(e.message || 'Could not load the dashboard.'));
  useEffect(() => {
    reload();
    invoke('getSampleStatus').then(setDemo).catch(() => {});
  }, []);

  // Demo mode (administrators only; the server checks too): one click creates a design doc, Jira issues and assumptions, or removes them.
  const runDemo = async (kind) => {
    setWorking(kind);
    setMessage(null);
    try {
      const r = await invoke(kind === 'create' ? 'generateSample' : 'removeSample');
      if (r.error) setMessage({ appearance: 'error', text: r.error });
      else if (kind === 'create') setMessage({ appearance: 'success', text: `Demo mode is on: a design doc, ${r.issueKeys.length} Jira issues in ${r.projectKey}, and ${r.assumptions} assumptions linked to the release "Checkout v2.0". Open the Releases tab.` });
      else setMessage({ appearance: 'success', text: 'Demo mode is off. The demo data was removed.' });
      setDemo(await invoke('getSampleStatus'));
      await reload();
      setVersion((v) => v + 1);
    } catch (e) {
      setMessage({ appearance: 'error', text: e.message || 'Something went wrong.' });
    } finally {
      setWorking(null);
    }
  };

  if (error) return <SectionMessage appearance="error" title="Something went wrong"><Text>{error}</Text></SectionMessage>;
  if (!data) return <Spinner label="Loading Assumption Health" />;

  const tiles = summarize(data.assumptions);
  const shown = filterAssumptions(data.assumptions, { status: status.value, search, sort: sort.value });

  const head = { cells: ['Assumption', 'Status', 'Matches / threshold', 'Release', 'Needs attention since', 'Page', 'Ticket', 'Last checked'].map((c) => ({ key: c, content: c })) };
  const rows = shown.map((a) => ({
    key: a.id,
    cells: [
      { key: 'text', content: <Button appearance="link" onClick={() => setOpenId(a.id)}>{a.text}</Button> },
      { key: 'status', content: <Lozenge appearance={APPEARANCE[a.status]} isBold>{STATUS_LABEL[a.status]}</Lozenge> },
      { key: 'count', content: a.count === null ? '-' : `${a.count} / ${a.threshold} (${a.windowDays}d)` },
      { key: 'release', content: a.releaseKey || '-' },
      { key: 'since', content: a.status === 'contradicted' || a.status === 'at-risk' ? fmt(a.trippedAt) : '-' },
      { key: 'page', content: <Link href={`${data.siteUrl}/wiki/pages/viewpage.action?pageId=${a.pageId}`} openNewTab>{a.pageTitle || 'Open page'}</Link> },
      { key: 'ticket', content: a.ticketKey ? <Link href={`${data.siteUrl}/browse/${a.ticketKey}`} openNewTab>{a.ticketKey} ({a.ticketStatus})</Link> : '-' },
      { key: 'checked', content: fmt(a.lastCheckedAt) },
    ],
  }));

  return (
    <Stack space="space.200">
      <Inline spread="space-between" alignBlock="center">
        <Stack space="space.050">
          <Heading size="large">Assumption Health</Heading>
          <Text>Which assumptions behind your releases has Jira already disproved? You only see assumptions on pages you can open.</Text>
        </Stack>
        {data.isAdmin && (
          <Inline space="space.100" alignBlock="center">
            {working ? (
              <>
                <Spinner size="small" />
                <Text>{working === 'create' ? 'Creating demo data (about 15 seconds)...' : 'Removing demo data...'}</Text>
              </>
            ) : demo.exists ? (
              <>
                <Lozenge appearance="information" isBold>Demo mode on</Lozenge>
                <Button onClick={() => runDemo('remove')}>Turn off</Button>
              </>
            ) : (
              <Button appearance="primary" onClick={() => runDemo('create')}>Demo mode</Button>
            )}
          </Inline>
        )}
      </Inline>
      {message && <SectionMessage appearance={message.appearance}><Text>{message.text}</Text></SectionMessage>}
      {(() => {
        const banner = attentionBanner(tiles);
        return banner ? <SectionMessage appearance={banner.appearance} title={banner.title}><Text>{banner.text}</Text></SectionMessage> : null;
      })()}

      <Inline space="space.200">
        <Tile label="Monitored" value={tiles.total} />
        <Tile label="Healthy" value={tiles.healthy} appearance="success" />
        <Tile label="At risk" value={tiles.atRisk} appearance="moved" />
        <Tile label="Contradicted" value={tiles.contradicted} appearance="removed" />
        <Tile label="Unverified or stale" value={tiles.unverified + tiles.stale} appearance="default" />
      </Inline>

      {data.hiddenCount > 0 && (
        <SectionMessage title="Some assumptions are hidden">
          <Text>{data.hiddenCount} assumption(s) are on pages you do not have permission to view, so they are not shown.</Text>
        </SectionMessage>
      )}

      <Tabs id="dashboard-tabs">
        <TabList>
          <Tab>Releases</Tab>
          <Tab>Assumptions</Tab>
          <Tab>Audit log</Tab>
        </TabList>
        <TabPanel>
          <ReleasesTab key={version} />
        </TabPanel>
        <TabPanel>
          <Stack space="space.200">
            <Inline space="space.100">
              <Select options={STATUS_OPTIONS} value={status} onChange={setStatus} />
              <Select options={SORT_OPTIONS} value={sort} onChange={setSort} />
              <Textfield placeholder="Search assumption, page, release or ticket" value={search} onChange={(e) => setSearch(e.target.value)} />
            </Inline>
            {openId && data.assumptions.find((x) => x.id === openId) && (
              <AssumptionDetail a={data.assumptions.find((x) => x.id === openId)} siteUrl={data.siteUrl} onChanged={reload} onClose={() => setOpenId(null)} />
            )}
            {data.assumptions.length === 0 ? (
              <EmptyState
                header="No assumptions yet"
                description="Open any Confluence page, click Hindsight under its title, and add the assumptions your design doc depends on. They will show up here. Administrators can also turn on Demo mode (top right) to see a ready-made example."
              />
            ) : (
              <DynamicTable
                head={head}
                rows={rows}
                rowsPerPage={10}
                emptyView={<Text>No assumptions match these filters.</Text>}
              />
            )}
          </Stack>
        </TabPanel>
        <TabPanel>
          <AuditTab />
        </TabPanel>
      </Tabs>
    </Stack>
  );
};

ForgeReconciler.render(<App />);
