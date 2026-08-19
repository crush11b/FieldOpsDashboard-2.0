import React, { useEffect, useRef, useState } from 'react';
import type { SmartDeployBrief } from '../../server/smartDeployBrief';
import { appendActivationNote, createActivationNotesForBrief, getActivationNotesForBrief, type ActivationNotesCollection, type ActivationNotesNoteKind } from '../activationNotesApi';

const QUICK_NOTES = ['On air', 'Band/mode changed', 'Conditions changed', 'Equipment adjusted', 'Off air'] as const;
const ACTIVATION_NOTES_MAX_NOTE_TEXT_LENGTH = 500;

interface ActivationNotesPanelProps {
  readonly brief: SmartDeployBrief;
}

export const ActivationNotesPanel: React.FC<ActivationNotesPanelProps> = ({ brief }) => {
  const [collection, setCollection] = useState<ActivationNotesCollection | null>(null);
  const [draft, setDraft] = useState('');
  const [loadState, setLoadState] = useState<'loading' | 'empty' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const requestSequence = useRef(0);
  const briefId = brief.briefId;
  const activation = brief.schemaVersion === 2 ? brief.activation : brief.mission.activationTarget;

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    setCollection(null);
    setDraft('');
    setMessage(null);
    setLoadState('loading');
    setSubmitting(false);
    void getActivationNotesForBrief(briefId, controller.signal).then(result => {
      if (sequence !== requestSequence.current) return;
      if (result.kind === 'activation_notes_empty') { setLoadState('empty'); return; }
      if (result.kind === 'activation_notes_error') { setLoadState('error'); setMessage(result.message); return; }
      setCollection(result.collection);
      setLoadState('ready');
    }).catch(error => {
      if (sequence !== requestSequence.current || error?.name === 'AbortError') return;
      setLoadState('error');
      setMessage('Activation Notes could not be loaded.');
    });
    return () => controller.abort();
  }, [briefId]);

  const submit = async (kind: ActivationNotesNoteKind, value: string) => {
    const text = value.replace(/\r\n?/g, '\n').trim();
    if (!text || text.length > ACTIVATION_NOTES_MAX_NOTE_TEXT_LENGTH || submitting) {
      if (!text) setMessage('Enter a note before saving.');
      else if (text.length > ACTIVATION_NOTES_MAX_NOTE_TEXT_LENGTH) setMessage(`Note is limited to ${ACTIVATION_NOTES_MAX_NOTE_TEXT_LENGTH} characters.`);
      return;
    }
    const sequence = requestSequence.current;
    setSubmitting(true);
    setMessage(null);
    try {
      let current = collection;
      if (!current) {
        const created = await createActivationNotesForBrief(briefId);
        if (sequence !== requestSequence.current) return;
        if (created.kind === 'activation_notes_error') { setMessage(created.code === 'brief_not_found' ? 'This SmartDeploy brief is no longer retained.' : created.message); return; }
        if (created.kind === 'activation_notes_empty') { setMessage('Activation Notes are not available for this brief.'); return; }
        current = created.collection;
        setCollection(current);
      }
      const appended = await appendActivationNote(current.collectionId, kind, text);
      if (sequence !== requestSequence.current) return;
      if (appended.kind === 'activation_notes_error') { setMessage(appended.message); return; }
      if (appended.kind === 'activation_notes_empty') { setMessage('Activation Notes are not available for this brief.'); return; }
      setCollection(appended.collection);
      setLoadState('ready');
      setDraft('');
    } catch {
      if (sequence === requestSequence.current) setMessage('The note could not be saved. Check the local server and try again.');
    } finally {
      if (sequence === requestSequence.current) setSubmitting(false);
    }
  };

  const retry = () => { setMessage(null); setLoadState('loading'); requestSequence.current += 1; const id = requestSequence.current; void getActivationNotesForBrief(briefId).then(result => { if (id !== requestSequence.current) return; if (result.kind === 'activation_notes_empty') setLoadState('empty'); else if (result.kind === 'activation_notes_error') { setLoadState('error'); setMessage(result.message); } else { setCollection(result.collection); setLoadState('ready'); } }).catch(() => { if (id === requestSequence.current) { setLoadState('error'); setMessage('Activation Notes could not be loaded.'); } }); };
  const notes = collection?.notes ?? [];

  return <section id="activation-notes" aria-label="Activation Notes" className="rounded-xl border border-cyan-700/60 bg-cyan-950/20 p-3 space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div><h4 className="font-black text-[11px] uppercase text-cyan-300">ACTIVATION NOTES</h4><p className="text-[10px] text-slate-400">{activation.program} {activation.reference}{activation.displayName ? ` - ${activation.displayName}` : ''}</p></div>
      {collection && <span className="text-[10px] text-slate-400">{notes.length} note{notes.length === 1 ? '' : 's'}</span>}
    </div>
    {loadState === 'loading' && <p role="status" className="text-[11px] text-slate-400">Loading Activation Notes...</p>}
    {loadState === 'error' && <div role="alert" className="space-y-2"><p className="text-[11px] text-red-200">{message || 'Activation Notes are unavailable.'}</p><button type="button" onClick={retry} className="px-3 py-2 rounded border border-cyan-700 text-cyan-200 text-[10px] font-bold">RETRY</button></div>}
    {loadState !== 'loading' && <>
      {loadState === 'empty' && <p className="text-[11px] text-slate-400">No notes yet. Add a quick note or a field observation.</p>}
      {collection && <>
        <p className="text-[10px] text-slate-400">Updated <time dateTime={collection.updatedAtUtc}>{formatUtc(collection.updatedAtUtc)}</time></p>
        <ol className="space-y-1.5" aria-label="Persisted activation notes">{notes.map(note => <li key={note.noteId} className="flex gap-2 text-[11px] text-slate-200"><time className="shrink-0 text-cyan-300" dateTime={note.recordedAtUtc} title={note.recordedAtUtc}>{formatNoteTime(note.recordedAtUtc)}</time><span className={note.kind === 'quick' ? 'text-amber-200' : 'text-slate-200'}>{note.text}</span></li>)}</ol>
      </>}
      <div className="flex flex-wrap gap-2" aria-label="Quick notes">{QUICK_NOTES.map(note => <button key={note} type="button" disabled={loadState === 'loading' || submitting} onClick={() => void submit('quick', note)} className="px-3 py-2 rounded border border-amber-700/70 bg-amber-950/30 text-amber-200 text-[10px] font-bold disabled:opacity-50">{note}</button>)}</div>
      <div className="space-y-1"><label htmlFor={`activation-note-input-${briefId}`} className="text-[10px] uppercase text-slate-400">Field note</label><textarea id={`activation-note-input-${briefId}`} value={draft} maxLength={ACTIVATION_NOTES_MAX_NOTE_TEXT_LENGTH} onChange={event => setDraft(event.target.value)} rows={2} placeholder="Add a field observation" disabled={loadState === 'loading' || submitting} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-200 text-[11px]" /><div className="flex items-center justify-between gap-2"><span className="text-[10px] text-slate-500">{draft.length}/{ACTIVATION_NOTES_MAX_NOTE_TEXT_LENGTH}</span><button type="button" disabled={loadState === 'loading' || submitting || !draft.trim()} onClick={() => void submit('text', draft)} className="px-3 py-2 rounded bg-cyan-700 text-white text-[10px] font-bold disabled:opacity-50">{submitting ? 'SAVING...' : 'ADD NOTE'}</button></div></div>
      {message && loadState !== 'error' && <p role="alert" className="text-[11px] text-red-200">{message}</p>}
    </>}
  </section>;
};

function formatNoteTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown time' : `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}Z`; }
function formatUtc(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toISOString().replace('T', ' ').replace('.000Z', ' UTC'); }