import React, { useEffect, useRef, useState } from 'react';
import type { SmartDeployBrief } from '../../server/smartDeployBrief';
import { createFieldReadinessChecklistForBrief, getFieldReadinessChecklistForBrief, resetFieldReadinessChecklist, updateFieldReadinessChecklistItem, type FieldReadinessChecklist, type FieldReadinessChecklistApiResult } from '../fieldReadinessChecklistApi';

interface FieldReadinessChecklistPanelProps { readonly brief: SmartDeployBrief; }
type LoadState = 'loading' | 'not_started' | 'ready' | 'error';

export const FieldReadinessChecklistPanel: React.FC<FieldReadinessChecklistPanelProps> = ({ brief }) => {
  const briefId = brief.briefId;
  const [checklist, setChecklist] = useState<FieldReadinessChecklist | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const requestSequence = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setChecklist(null);
    setLoadState('loading');
    setMessage(null);
    setSaving(false);
    setConfirmReset(false);
    void getFieldReadinessChecklistForBrief(briefId, controller.signal).then(result => {
      if (sequence !== requestSequence.current) return;
      applyLoadResult(result);
    }).catch(error => {
      if (sequence !== requestSequence.current || error?.name === 'AbortError') return;
      setLoadState('error');
      setMessage('Field Readiness Checklist could not be loaded. Check the local server and try again.');
    });
    return () => controller.abort();
  }, [briefId]);

  const applyLoadResult = (result: FieldReadinessChecklistApiResult) => {
    if (result.kind === 'field_readiness_checklist_empty') { setLoadState('not_started'); return; }
    if (result.kind === 'field_readiness_checklist_error') { setLoadState('error'); setMessage(formatChecklistError(result)); return; }
    if (result.checklist.briefId !== briefId) { setLoadState('error'); setMessage('The checklist response did not match this SmartDeploy brief.'); return; }
    setChecklist(result.checklist);
    setLoadState('ready');
  };

  const start = async () => {
    if (saving || loadState === 'loading') return;
    const sequence = requestSequence.current;
    setSaving(true);
    setMessage(null);
    try {
      const result = await createFieldReadinessChecklistForBrief(briefId);
      if (sequence !== requestSequence.current) return;
      if (result.kind !== 'field_readiness_checklist') { setMessage(formatChecklistError(result, 'Field Readiness Checklist could not be started.')); return; }
      if (result.checklist.briefId !== briefId) { setMessage('The checklist response did not match this SmartDeploy brief.'); return; }
      setChecklist(result.checklist);
      setLoadState('ready');
    } catch {
      if (sequence === requestSequence.current) setMessage('Field Readiness Checklist could not be started. Check the local server and try again.');
    } finally {
      if (sequence === requestSequence.current) setSaving(false);
    }
  };

  const saveItem = async (itemId: string, completed: boolean) => {
    if (!checklist || saving || loadState !== 'ready') return;
    const sequence = requestSequence.current;
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateFieldReadinessChecklistItem(checklist.checklistId, itemId, completed);
      if (sequence !== requestSequence.current) return;
      if (result.kind !== 'field_readiness_checklist') { setMessage(formatChecklistError(result, 'The checklist item could not be saved.')); return; }
      if (result.checklist.briefId !== briefId) { setMessage('The checklist response did not match this SmartDeploy brief.'); return; }
      setChecklist(result.checklist);
    } catch {
      if (sequence === requestSequence.current) setMessage('The checklist item was not saved. Check the local server and try again.');
    } finally {
      if (sequence === requestSequence.current) setSaving(false);
    }
  };

  const reset = async () => {
    if (!checklist || saving) return;
    const sequence = requestSequence.current;
    setSaving(true);
    setMessage(null);
    try {
      const result = await resetFieldReadinessChecklist(checklist.checklistId);
      if (sequence !== requestSequence.current) return;
      if (result.kind !== 'field_readiness_checklist') { setMessage(formatChecklistError(result, 'The checklist could not be reset.')); return; }
      if (result.checklist.briefId !== briefId) { setMessage('The checklist response did not match this SmartDeploy brief.'); return; }
      setChecklist(result.checklist);
      setConfirmReset(false);
    } catch {
      if (sequence === requestSequence.current) setMessage('The checklist was not reset. Check the local server and try again.');
    } finally {
      if (sequence === requestSequence.current) setSaving(false);
    }
  };

  const retry = () => {
    setMessage(null);
    setLoadState('loading');
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    void getFieldReadinessChecklistForBrief(briefId, controller.signal).then(result => {
      if (sequence !== requestSequence.current) return;
      applyLoadResult(result);
    }).catch(error => {
      if (sequence !== requestSequence.current || error?.name === 'AbortError') return;
      setLoadState('error');
      setMessage('Field Readiness Checklist could not be loaded. Check the local server and try again.');
    });
  };

  const completed = checklist?.sections.flatMap(section => section.items).filter(item => item.completed).length ?? 0;
  return <section id="field-readiness-checklist" aria-label="Field Readiness Checklist" className="rounded-xl border border-emerald-700/60 bg-emerald-950/20 p-3 space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h4 className="font-black text-[11px] uppercase text-emerald-300">FIELD READINESS</h4><p className="text-[10px] text-slate-400">{checklist ? `${completed} of ${checklist.sections.flatMap(section => section.items).length} complete` : 'Not started'}</p></div>
      {checklist && <div className="flex flex-wrap items-center gap-2"><span className="text-[10px] text-slate-400">Updated <time dateTime={checklist.updatedAtUtc}>{formatUtc(checklist.updatedAtUtc)}</time></span>{!confirmReset && <button type="button" onClick={() => setConfirmReset(true)} disabled={saving} className="px-3 py-2 rounded border border-amber-700 text-amber-200 text-[10px] font-bold disabled:opacity-50">RESET CHECKLIST</button>}</div>}
    </div>
    {loadState === 'loading' && <p role="status" className="text-[11px] text-slate-400">Loading Field Readiness Checklist...</p>}
    {loadState === 'error' && <div role="alert" className="space-y-2"><p className="text-[11px] text-red-200">{message || 'Field Readiness Checklist is unavailable.'}</p><button type="button" onClick={retry} disabled={saving} className="px-3 py-2 rounded border border-emerald-700 text-emerald-200 text-[10px] font-bold disabled:opacity-50">RETRY</button></div>}
    {loadState === 'not_started' && <div className="space-y-2"><p className="text-[11px] text-slate-300">No checklist has been started for this SmartDeploy brief.</p><button type="button" onClick={() => void start()} disabled={saving} className="w-full py-3 rounded bg-emerald-500 text-slate-950 text-xs font-black disabled:opacity-50">{saving ? 'STARTING CHECKLIST...' : 'START CHECKLIST'}</button>{message && <p role="alert" className="text-[11px] text-red-200">{message}</p>}</div>}
    {checklist && confirmReset && <div role="alertdialog" aria-label="Confirm checklist reset" className="rounded-lg border border-amber-700/70 bg-amber-950/30 p-3 space-y-2"><p className="text-[11px] text-amber-100">Reset every checklist item to incomplete?</p><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void reset()} disabled={saving} className="px-3 py-2 rounded bg-amber-500 text-slate-950 text-[10px] font-black disabled:opacity-50">CONFIRM RESET</button><button type="button" onClick={() => setConfirmReset(false)} disabled={saving} className="px-3 py-2 rounded border border-slate-600 text-slate-200 text-[10px] font-bold disabled:opacity-50">CANCEL</button></div></div>}
    {checklist && <div className="space-y-2">{checklist.sections.map((section, index) => <details key={section.sectionId} open={index === 0} className="rounded-lg border border-slate-700 bg-slate-950/50"><summary className="cursor-pointer px-3 py-3 text-[11px] font-black uppercase text-emerald-200">{section.title}</summary><div className="space-y-1 p-2">{section.items.map(item => <label key={item.itemId} className={`flex w-full items-start gap-3 rounded border border-slate-700 bg-slate-900/70 p-3 text-[11px] text-slate-200 ${saving ? 'opacity-60' : 'cursor-pointer'}`}><input type="checkbox" aria-label={item.text} checked={item.completed} onChange={event => void saveItem(item.itemId, event.target.checked)} disabled={saving} className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-400" /><span>{item.text}</span></label>)}</div></details>)}{message && <p role="alert" className="text-[11px] text-red-200">{message}</p>}</div>}
  </section>;
};

function formatChecklistError(result: FieldReadinessChecklistApiResult, fallback = 'Field Readiness Checklist is unavailable.'): string {
  if (result.kind !== 'field_readiness_checklist_error') return fallback;
  if (result.code === 'brief_not_found') return 'This SmartDeploy brief is no longer retained.';
  if (result.code === 'persistence_unavailable') return 'The local server could not save or load this checklist.';
  return result.message || fallback;
}

function formatUtc(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toISOString().replace('T', ' ').replace('.000Z', ' UTC'); }