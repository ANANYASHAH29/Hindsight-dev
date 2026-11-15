// Hindsight settings (Confluence admin > Apps > Hindsight). UI Kit components only.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Heading, HelperMessage, Inline, Label, SectionMessage, Select, Spinner, Stack, Text, Textfield, Toggle } from '@forge/react';
import { invoke } from '@forge/bridge';

const INTERVALS = [
  { label: 'Every hour', value: 60 },
  { label: 'Every 3 hours', value: 180 },
  { label: 'Every 6 hours', value: 360 },
  { label: 'Every 12 hours', value: 720 },
  { label: 'Every 24 hours', value: 1440 },
];

const App = () => {
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState(null); // { appearance, text }
  const [saving, setSaving] = useState(false);
  const [reset, setReset] = useState({ stage: 'idle', preview: null, working: false, message: null }); // stage: idle | confirm

  useEffect(() => {
    invoke('getSettings')
      .then((r) => setForm({
        projectKey: r.settings.projectKey || '',
        defaultWindowDays: String(r.settings.defaultWindowDays),
        defaultThreshold: String(r.settings.defaultThreshold),
        checkIntervalMinutes: INTERVALS.find((i) => i.value === r.settings.checkIntervalMinutes) || INTERVALS[0],
        confluenceComments: Boolean(r.settings.confluenceComments),
      }))
      .catch((e) => setMessage({ appearance: 'error', text: e.message }));
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const r = await invoke('saveSettings', {
        projectKey: form.projectKey,
        defaultWindowDays: form.defaultWindowDays,
        defaultThreshold: form.defaultThreshold,
        checkIntervalMinutes: form.checkIntervalMinutes.value,
        confluenceComments: form.confluenceComments,
      });
      if (r.error) setMessage({ appearance: 'error', text: r.error });
      else setMessage({ appearance: 'success', text: 'Settings saved.' });
    } catch (e) {
      setMessage({ appearance: 'error', text: e.message || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  // Reset, step 1: show exactly what would be deleted. Nothing is changed yet.
  const reviewReset = async () => {
    setReset({ stage: 'idle', preview: null, working: true, message: null });
    try {
      const r = await invoke('previewReset');
      if (r.error) throw new Error(r.error);
      setReset({ stage: 'confirm', preview: r, working: false, message: null });
    } catch (e) {
      setReset({ stage: 'idle', preview: null, working: false, message: { appearance: 'error', text: e.message || 'Could not prepare the reset.' } });
    }
  };
  // Reset, step 2: the administrator confirmed.
  const confirmReset = async () => {
    setReset({ ...reset, working: true, message: null });
    try {
      const r = await invoke('resetAll');
      if (r.error) throw new Error(r.error);
      const text = `Done. Deleted ${r.deletedRecords} stored record(s) and ${r.deletedTickets} Revisit ticket(s).${r.problems.length ? ` Some things need a look: ${r.problems.join(' ')}` : ''}`;
      setReset({ stage: 'idle', preview: null, working: false, message: { appearance: r.ok ? 'success' : 'warning', text } });
    } catch (e) {
      setReset({ stage: 'idle', preview: null, working: false, message: { appearance: 'error', text: e.message || 'The reset failed.' } });
    }
  };

  if (!form) return message ? <SectionMessage appearance="error"><Text>{message.text}</Text></SectionMessage> : <Spinner label="Loading settings" />;

  return (
    <Stack space="space.200">
      <Heading size="large">Hindsight settings</Heading>
      {message && <SectionMessage appearance={message.appearance}><Text>{message.text}</Text></SectionMessage>}

      <Stack space="space.050">
        <Label labelFor="project">Jira project for "Revisit assumption" tickets</Label>
        <Textfield id="project" width="small" placeholder="e.g. HSW" value={form.projectKey} onChange={(e) => setForm({ ...form, projectKey: e.target.value })} />
        <HelperMessage>The project key where Hindsight creates one ticket when an assumption breaks.</HelperMessage>
      </Stack>

      <Inline space="space.200">
        <Stack space="space.050">
          <Label labelFor="window">Default window (days)</Label>
          <Textfield id="window" width="small" value={form.defaultWindowDays} onChange={(e) => setForm({ ...form, defaultWindowDays: e.target.value })} />
        </Stack>
        <Stack space="space.050">
          <Label labelFor="threshold">Default threshold (issues)</Label>
          <Textfield id="threshold" width="small" value={form.defaultThreshold} onChange={(e) => setForm({ ...form, defaultThreshold: e.target.value })} />
        </Stack>
      </Inline>
      <HelperMessage>Pre-filled when someone adds a new assumption. They can still change it.</HelperMessage>

      <Stack space="space.050">
        <Label labelFor="interval">How often to re-check assumptions</Label>
        <Select inputId="interval" options={INTERVALS} value={form.checkIntervalMinutes} onChange={(opt) => setForm({ ...form, checkIntervalMinutes: opt })} />
        <HelperMessage>Hindsight runs hourly and skips assumptions checked more recently than this.</HelperMessage>
      </Stack>

      <Inline space="space.100" alignBlock="center">
        <Toggle id="comments" isChecked={form.confluenceComments} onChange={(e) => setForm({ ...form, confluenceComments: e.target.checked })} />
        <Label labelFor="comments">Add a Confluence comment on the page when an assumption breaks</Label>
      </Inline>

      {saving ? <Spinner size="small" /> : <Inline><Button appearance="primary" onClick={save}>Save settings</Button></Inline>}

      <Heading size="medium">Reset Hindsight data</Heading>
      <Text>Start again from a clean slate. This deletes everything Hindsight stored (assumptions, their history, and the per-page monitoring settings) and the "Revisit assumption" tickets it created. It never deletes your own Jira issues or Confluence pages, or the settings above. It cannot be undone.</Text>
      {reset.message && <SectionMessage appearance={reset.message.appearance}><Text>{reset.message.text}</Text></SectionMessage>}
      {reset.stage === 'confirm' && reset.preview && (
        <SectionMessage appearance="warning" title="This will permanently delete:">
          <Stack space="space.050">
            {reset.preview.lines.map((line) => <Text key={line}>{line}</Text>)}
          </Stack>
        </SectionMessage>
      )}
      {reset.working ? <Spinner size="small" /> : reset.stage === 'confirm' ? (
        <Inline space="space.100">
          <Button appearance="danger" onClick={confirmReset}>Yes, delete all Hindsight data</Button>
          <Button onClick={() => setReset({ stage: 'idle', preview: null, working: false, message: null })}>Cancel</Button>
        </Inline>
      ) : (
        <Inline><Button onClick={reviewReset}>Review what will be deleted</Button></Inline>
      )}

    </Stack>
  );
};

ForgeReconciler.render(<App />);
