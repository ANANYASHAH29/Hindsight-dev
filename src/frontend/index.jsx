// The Hindsight panel on a Confluence page (UI Kit: only @forge/react components allowed).
// The small popup under the page title just shows a summary. "Open Hindsight" opens a large centered
// window with tabs, so nothing needs long scrolling.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, Checkbox, Heading, Inline, Link, Lozenge, Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition,
  ProgressBar, SectionMessage, Select, Spinner, Stack, Strong, Tab, TabList, TabPanel, Tabs, Text, TextArea, Textfield, Toggle,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { STATUS_APPEARANCE, STATUS_LABEL } from '../lib/assess.js';
import { gauge, summaryLine, metaLine } from '../lib/format.js';
import { planFinished } from '../lib/plan.js';

// Tripwire templates shown in the dropdown (the JQL is built by the backend from these).
const TEMPLATE_OPTIONS = [
  { label: 'Bug count in a component', value: 'bug-component', needsValue: true, valueLabel: 'Component name, e.g. Checkout' },
  { label: 'Incident count', value: 'incident', needsValue: false },
  { label: 'Issues with a label', value: 'label', needsValue: true, valueLabel: 'Label, e.g. payments' },
  { label: 'Issues matching text', value: 'text', needsValue: true, valueLabel: 'Words to search for' },
  { label: 'Custom JQL (advanced)', value: 'custom', needsValue: false },
];

// Colour of the status lozenge.
const APPEARANCE = STATUS_APPEARANCE;

const TAB_ASSUMPTIONS = 0;
const TAB_ADD = 1;

const App = () => {
  const [open, setOpen] = useState(false);        // is the big window open?
  const [tab, setTab] = useState(TAB_ASSUMPTIONS);
  const [data, setData] = useState(null);         // { assumptions, settings }
  const [error, setError] = useState(null);       // red message
  const [notice, setNotice] = useState(null);     // green message
  const [busyId, setBusyId] = useState(null);     // which assumption is being checked
  const [form, setForm] = useState({ text: '', jql: '', release: '', windowDays: '14', threshold: '3' });
  const [projectKey, setProjectKey] = useState('');
  const [template, setTemplate] = useState(TEMPLATE_OPTIONS[4]); // default: custom JQL (works everywhere)
  const [tplProject, setTplProject] = useState('');
  const [tplValue, setTplValue] = useState('');
  const [scopeJql, setScopeJql] = useState('');   // the Jira area this doc covers (freshness check)
  const [drift, setDrift] = useState(null);
  const [checkingDrift, setCheckingDrift] = useState(false);
  const [suggestions, setSuggestions] = useState(null); // null = not asked yet; [] = none found
  const [suggesting, setSuggesting] = useState(false);
  const [picked, setPicked] = useState({});        // the plan steps a person has ticked: { assumptionId: { stepId: true } }
  const [expanded, setExpanded] = useState({});      // which cards show their details: { assumptionId: true }
  const [applying, setApplying] = useState(null);  // id of the assumption whose plan is being applied

  const load = async () => {
    const d = await invoke('getPanelData');
    setData(d);
    setProjectKey(d.settings.projectKey || '');
    // Pre-fill the add form from the admin's default window/threshold (only while the form is untouched).
    setForm((f) => (f.text || f.jql ? f : { ...f, windowDays: String(d.settings.defaultWindowDays), threshold: String(d.settings.defaultThreshold) }));
  };
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  // Runs any action; shows a clear message (never fails silently) and an optional success note.
  const run = async (fn, okMessage) => {
    setError(null); setNotice(null);
    try {
      await fn();
      if (okMessage) setNotice(okMessage);
    } catch (e) {
      setError(e.message || 'Unexpected error');
    }
  };

  const add = () => run(async () => {
    let jql = form.jql;
    if (template.value !== 'custom') {
      // Ask the backend to turn the template + project + value into JQL.
      const built = await invoke('buildTemplate', { template: template.value, project: tplProject || projectKey, value: tplValue });
      if (built.error) throw new Error(built.error);
      jql = built.jql;
    }
    const r = await invoke('addAssumption', { ...form, jql, template: template.value });
    if (r.error) throw new Error(r.error);
    setForm({ ...form, text: '', jql: '' });
    setTplValue('');
    await load();
    setTab(TAB_ASSUMPTIONS); // show the new assumption in the list
  }, 'Assumption added.');

  const check = (id) => run(async () => {
    setBusyId(id);
    try {
      const r = await invoke('checkNow', { id });
      if (r.error) throw new Error(r.error);
    } finally {
      setBusyId(null);
      await load();
    }
  });

  const remove = (id) => run(async () => {
    const r = await invoke('deleteAssumption', { id });
    if (r.error) throw new Error(r.error);
    await load();
  }, 'Assumption deleted.');

  // Doc freshness: optionally save which Jira area this doc covers, then compare Jira activity to the page's last edit.
  const checkDrift = (save) => run(async () => {
    setCheckingDrift(true);
    try {
      if (save) {
        const saved = await invoke('saveDrift', { scopeJql });
        if (saved.error) throw new Error(saved.error);
      }
      const r = await invoke('getDrift');
      if (r.error) throw new Error(r.error);
      setDrift(r);
      if (r.configured && !scopeJql) setScopeJql(r.scopeJql);
    } finally {
      setCheckingDrift(false);
    }
  });
  // Check freshness automatically once, so the summary can show it.
  useEffect(() => { if (data) checkDrift(false); }, [Boolean(data)]);

  // Read the page and propose assumptions. Nothing is saved until the human accepts one.
  const suggest = () => run(async () => {
    setSuggesting(true);
    try {
      const r = await invoke('suggestAssumptions');
      if (r.error) throw new Error(r.error);
      setSuggestions(r.suggestions);
    } finally {
      setSuggesting(false);
    }
  });
  // "Use this": copy the sentence into the form so the human picks the tripwire, then clicks Add.
  const accept = (sugg) => {
    setForm({ ...form, text: sugg.text });
    setSuggestions(suggestions.filter((x) => x !== sugg));
    setNotice('Copied into the form. Choose a tripwire below and click "Add assumption" to save it.');
  };
  const dismiss = (sugg) => setSuggestions(suggestions.filter((x) => x !== sugg));

  // The agent's plan: tick the steps you approve, then Apply. Hindsight performs them as you.
  const tick = (id, stepId, on) => setPicked({ ...picked, [id]: { ...(picked[id] || {}), [stepId]: on } });
  const tickAll = (a) => setPicked({ ...picked, [a.id]: Object.fromEntries(a.resolutionPlan.steps.filter((x) => x.state !== 'done').map((x) => [x.id, true])) });
  const applyPlan = (a) => run(async () => {
    const stepIds = Object.entries(picked[a.id] || {}).filter(([, on]) => on).map(([sid]) => sid);
    setApplying(a.id);
    try {
      const r = await invoke('applyPlan', { id: a.id, stepIds });
      if (r.error) throw new Error(r.error);
      const done = Object.values(r.results).filter((x) => x.ok).length;
      setPicked({ ...picked, [a.id]: {} });
      setNotice(`${done} of ${stepIds.length} step(s) done. Each result is shown next to its step.`);
    } finally {
      setApplying(null);
      await load();
    }
  });
  const discardPlan = (a) => run(async () => {
    const r = await invoke('dismissPlan', { id: a.id });
    if (r.error) throw new Error(r.error);
    await load();
  }, 'The plan was discarded.');

  const toggleComments = (checked) => run(async () => {
    const r = await invoke('saveSettings', { confluenceComments: checked });
    if (r.error) throw new Error(r.error);
    await load();
  }, checked ? 'Confluence comments are ON for newly broken assumptions.' : 'Confluence comments are OFF.');

  const saveProject = () => run(async () => {
    const r = await invoke('saveSettings', { projectKey });
    if (r.error) throw new Error(r.error);
    await load();
  }, `Saved. Revisit tickets will be created in project ${projectKey.trim().toUpperCase() || '(none)'}.`);

  if (!data) return error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : <Spinner label="Loading Hindsight" />;

  const count = (s) => data.assumptions.filter((a) => a.view.status === s).length;

  return (
    <Stack space="space.150">
      {/* ---- The small summary shown in the popup under the page title ---- */}
      <Heading size="medium">Hindsight</Heading>
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance="removed" isBold>{count('contradicted')} contradicted</Lozenge>
        <Lozenge appearance="moved">{count('at-risk')} at risk</Lozenge>
        <Lozenge appearance="success">{count('healthy')} healthy</Lozenge>
        <Lozenge>{count('unverified') + count('stale')} unverified or stale</Lozenge>
      </Inline>
      {data.assumptions.some((a) => a.resolutionPlan && !planFinished(a.resolutionPlan)) && (
        <Inline space="space.100" alignBlock="center">
          <Lozenge appearance="information" isBold>Plan ready to approve</Lozenge>
          <Text>Open Hindsight and tick the steps you approve.</Text>
        </Inline>
      )}
      {drift && drift.configured && (
        <Inline space="space.100" alignBlock="center">
          <Lozenge appearance={drift.stale ? 'removed' : 'success'}>{drift.stale ? 'Doc possibly out of date' : 'Doc looks current'}</Lozenge>
        </Inline>
      )}
      <Inline><Button appearance="primary" onClick={() => setOpen(true)}>Open Hindsight</Button></Inline>

      {/* ---- The large centered window ---- */}
      <ModalTransition>
        {open && (
          <Modal width="xlarge" onClose={() => setOpen(false)}>
            <ModalHeader><ModalTitle>Hindsight: assumptions on this page</ModalTitle></ModalHeader>
            <ModalBody>
              <Stack space="space.200">
                {notice && <SectionMessage appearance="success"><Text>{notice}</Text></SectionMessage>}
                {error && <SectionMessage appearance="error" title="Something went wrong"><Text>{error}</Text></SectionMessage>}

                <Tabs id="hindsight-tabs" selected={tab} onChange={(i) => setTab(i)}>
                  <TabList>
                    <Tab>Assumptions ({data.assumptions.length})</Tab>
                    <Tab>Add assumption</Tab>
                    <Tab>Doc freshness</Tab>
                    <Tab>Settings</Tab>
                  </TabList>

                  {/* TAB 1: the list */}
                  <TabPanel>
                    <Stack space="space.150">
                      {data.assumptions.length === 0 && (
                        <SectionMessage title="No assumptions yet">
                          <Text>Open the "Add assumption" tab. Write the assumption and a Jira query that would prove it wrong, or let Hindsight suggest some from this page.</Text>
                        </SectionMessage>
                      )}
                      {data.assumptions.map((a) => (
                        <Box key={a.id} padding="space.150">
                          <Stack space="space.100">
                            <Inline space="space.100" alignBlock="center">
                              <Lozenge appearance={APPEARANCE[a.view.status]} isBold>{STATUS_LABEL[a.view.status]}</Lozenge>
                              <Text><Strong>{a.text}</Strong></Text>
                            </Inline>
                            <ProgressBar value={gauge(a.view.counts)} appearance={a.view.status === 'healthy' ? 'success' : 'default'} ariaLabel="Matching issues compared with the threshold" />
                            <Text>{summaryLine(a.view.counts, a.tripwire.windowDays)}</Text>
                            <Text>{metaLine(a)}</Text>
                            {a.riskAccepted && new Date(a.riskAccepted.until) > new Date() && (
                              <Text>Risk accepted until {String(a.riskAccepted.until).slice(0, 10)}: {a.riskAccepted.reason}</Text>
                            )}
                            {a.error && <Text>{a.error}</Text>}
                            {expanded[a.id] && (
                              <Stack space="space.100">
                                {a.view.reasons.map((reason) => <Text key={reason}>{reason}</Text>)}
                                <Text>Query: {a.tripwire.jql}</Text>
                                {(a.view.status === 'contradicted' || a.view.status === 'at-risk') && a.impactNote && <Text>{a.impactNote}</Text>}
                              </Stack>
                            )}
                            {a.resolutionPlan && a.resolutionPlan.steps.length > 0 && (
                              <Box padding="space.150">
                                <Stack space="space.100">
                                  <Heading size="small">{a.resolutionPlan.origin === 'agent' ? 'Plan prepared by the Hindsight agent' : 'Recommended plan'}</Heading>
                                  <Text>{a.resolutionPlan.origin === 'agent' ? 'The agent drafted this plan.' : 'Hindsight prepared this automatically from the evidence.'} Nothing has been done yet. Tick the steps you approve, then click Apply. Each step runs as you.</Text>
                                  {a.resolutionPlan.steps.map((st) => (
                                    <Inline key={st.id} space="space.100" alignBlock="center">
                                      {st.state === 'done' || st.state === 'failed' ? (
                                        <Lozenge appearance={st.state === 'done' ? 'success' : 'removed'} isBold>{st.state === 'done' ? 'Done' : 'Failed'}</Lozenge>
                                      ) : null}
                                      {st.state === 'done' ? (
                                        <Text>{st.label} - {st.result}</Text>
                                      ) : (
                                        <Checkbox
                                          label={st.state === 'failed' ? `${st.label} (failed: ${st.result}. Tick to retry)` : st.label}
                                          isChecked={Boolean(picked[a.id] && picked[a.id][st.id])}
                                          onChange={(e) => tick(a.id, st.id, e.target.checked)}
                                        />
                                      )}
                                      {st.url && <Link href={st.url} openNewTab>Open</Link>}
                                    </Inline>
                                  ))}
                                  <Inline space="space.100" alignBlock="center">
                                    {applying === a.id ? <Spinner size="small" /> : (
                                      <>
                                        <Button appearance="primary" onClick={() => applyPlan(a)}>Apply selected</Button>
                                        <Button onClick={() => tickAll(a)}>Tick all</Button>
                                        <Button appearance="subtle" onClick={() => discardPlan(a)}>Discard plan</Button>
                                      </>
                                    )}
                                  </Inline>
                                </Stack>
                              </Box>
                            )}
                            <Inline space="space.100">
                              {busyId === a.id ? <Spinner size="small" /> : <Button appearance="primary" onClick={() => check(a.id)}>Check now</Button>}
                              <Button appearance="subtle" onClick={() => setExpanded({ ...expanded, [a.id]: !expanded[a.id] })}>{expanded[a.id] ? 'Hide details' : 'Details'}</Button>
                              <Button appearance="subtle" onClick={() => remove(a.id)}>Delete</Button>
                            </Inline>
                          </Stack>
                        </Box>
                      ))}
                    </Stack>
                  </TabPanel>

                  {/* TAB 2: suggest + add */}
                  <TabPanel>
                    <Stack space="space.200">
                      <Heading size="small">Suggest assumptions from the page text</Heading>
                      <Inline space="space.100" alignBlock="center">
                        {suggesting ? <Spinner size="small" /> : <Button onClick={suggest}>Suggest assumptions from this page</Button>}
                        <Text>Drafted by plain code. You confirm each one.</Text>
                      </Inline>
                      {suggestions && suggestions.length === 0 && (
                        <SectionMessage title="No new suggestions"><Text>Nothing in the page looks like an assumption (or they are all saved already). You can still add one by hand below.</Text></SectionMessage>
                      )}
                      {suggestions && suggestions.map((sg) => (
                        <Box key={sg.text} padding="space.100">
                          <Stack space="space.050">
                            <Text>{sg.text}</Text>
                            <Inline space="space.100" alignBlock="center">
                              <Lozenge>{sg.reason}</Lozenge>
                              <Button appearance="primary" onClick={() => accept(sg)}>Use this</Button>
                              <Button appearance="subtle" onClick={() => dismiss(sg)}>Dismiss</Button>
                            </Inline>
                          </Stack>
                        </Box>
                      ))}

                      <Heading size="small">Add an assumption</Heading>
                      <TextArea placeholder='e.g. "Checkout handles 1,000 orders/min"' value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
                      <Textfield placeholder='Release this assumption belongs to (optional), e.g. "Checkout v2.0" or KAN-3' value={form.release} onChange={(e) => setForm({ ...form, release: e.target.value })} />
                      <Select options={TEMPLATE_OPTIONS} value={template} onChange={(opt) => setTemplate(opt)} placeholder="Choose a tripwire template" />
                      {template.value === 'custom' ? (
                        <Textfield placeholder='JQL that would disprove it, e.g. project = HSW AND issuetype = Bug' value={form.jql} onChange={(e) => setForm({ ...form, jql: e.target.value })} />
                      ) : (
                        <Inline space="space.100">
                          <Textfield width="small" placeholder={`Project key (default ${projectKey || 'e.g. HSW'})`} value={tplProject} onChange={(e) => setTplProject(e.target.value)} />
                          {template.needsValue && <Textfield placeholder={template.valueLabel} value={tplValue} onChange={(e) => setTplValue(e.target.value)} />}
                        </Inline>
                      )}
                      <Inline space="space.100">
                        <Textfield width="small" placeholder="Window (days)" value={form.windowDays} onChange={(e) => setForm({ ...form, windowDays: e.target.value })} />
                        <Textfield width="small" placeholder="Trips at (count)" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} />
                        <Button appearance="primary" onClick={add}>Add assumption</Button>
                      </Inline>
                    </Stack>
                  </TabPanel>

                  {/* TAB 3: freshness */}
                  <TabPanel>
                    <Stack space="space.150">
                      <Heading size="small">Is this doc still up to date?</Heading>
                      <Text>Tell Hindsight which Jira work this doc covers. It compares recent changes in Jira with the date this page was last edited.</Text>
                      <Textfield placeholder="Jira work this doc covers, e.g. project = HSW  (or: parent = HSW-12)" value={scopeJql} onChange={(e) => setScopeJql(e.target.value)} />
                      <Inline space="space.100" alignBlock="center">
                        {checkingDrift ? <Spinner size="small" /> : <Button appearance="primary" onClick={() => checkDrift(true)}>Check doc freshness</Button>}
                      </Inline>
                      {drift && drift.configured && (
                        <Box padding="space.100">
                          <Stack space="space.100">
                            <Inline space="space.100" alignBlock="center">
                              <Lozenge appearance={drift.stale ? 'removed' : 'success'} isBold>{drift.stale ? 'Possibly out of date' : 'Looks current'}</Lozenge>
                              <Text>
                                {drift.count} Jira issue(s) changed since this page was last edited{drift.daysSince !== null ? ` ${drift.daysSince} day(s) ago` : ''}.
                                {drift.stale ? ` That is ${drift.threshold} or more, so the doc may no longer match the work.` : ''}
                              </Text>
                            </Inline>
                            {drift.issues.length > 0 && <Text>Recent changes: {drift.issues.map((i) => `${i.key} (${i.summary})`).join('; ')}</Text>}
                          </Stack>
                        </Box>
                      )}
                    </Stack>
                  </TabPanel>

                  {/* TAB 4: settings */}
                  <TabPanel>
                    <Stack space="space.150">
                      <Heading size="small">Where to create "Revisit" tickets</Heading>
                      <Inline space="space.100">
                        <Textfield width="small" placeholder="Project key, e.g. HSW" value={projectKey} onChange={(e) => setProjectKey(e.target.value)} />
                        <Button onClick={saveProject}>Save project</Button>
                      </Inline>
                      <Inline space="space.100" alignBlock="center">
                        <Toggle id="comments-toggle" isChecked={Boolean(data.settings.confluenceComments)} onChange={(e) => toggleComments(e.target.checked)} />
                        <Text>Also comment on the Confluence page when an assumption breaks</Text>
                      </Inline>
                    </Stack>
                  </TabPanel>
                </Tabs>
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setOpen(false)}>Close</Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </Stack>
  );
};

ForgeReconciler.render(<App />);
