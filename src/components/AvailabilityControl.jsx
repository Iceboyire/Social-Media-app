import { useState } from 'react';
import { Check, ChevronDown, Clock3, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/Button';
import { supabase } from '../lib/supabase';
import { useAvailability } from '../hooks/useAvailability';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

const OPTIONS = [
  ['free_now', 'Free now'],
  ['free_tonight', 'Free tonight'],
  ['busy', 'Busy'],
  ['studying', 'Studying'],
  ['out', 'Out'],
];

function minutesUntilTonight() {
  const now = new Date();
  const tonight = new Date(now);
  tonight.setHours(23, 59, 0, 0);
  return Math.max(1, Math.min(1440, Math.ceil((tonight.getTime() - now.getTime()) / 60_000)));
}

export function AvailabilityControl() {
  const { user } = useAuth();
  const { own } = useAvailability();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(own.data?.note ?? '');
  const [saving, setSaving] = useState(false);
  const current = own.data;
  const circles = useQuery({
    queryKey: ['circles', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('circles').select('id, name, color').eq('owner_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(user?.id),
    retry: 1,
  });

  async function update(state, duration = 60) {
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('set_availability', {
        p_state: state,
        p_note: note.trim(),
        p_duration_minutes: duration,
        p_hidden: current?.is_hidden ?? false,
        p_visible_to_circle_id: current?.visible_to_circle_id ?? null,
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['availability'] });
      toast('Your hangout status is updated.', 'success');
    } catch (error) {
      toast(error.message || 'Your status could not be updated.');
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('clear_availability');
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['availability'] });
      setNote('');
      toast('Your hangout status is cleared.', 'success');
    } catch (error) {
      toast(error.message || 'Your status could not be cleared.');
    } finally {
      setSaving(false);
    }
  }

  async function setVisibility(circleId) {
    if (!current || saving) return;
    const duration = Math.max(1, Math.min(1440, Math.ceil((new Date(current.expires_at).getTime() - Date.now()) / 60_000)));
    setSaving(true);
    try {
      const { error } = await supabase.rpc('set_availability', {
        p_state: current.state,
        p_note: current.note,
        p_duration_minutes: duration,
        p_hidden: current.is_hidden,
        p_visible_to_circle_id: circleId || null,
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['availability'] });
      toast(circleId ? 'Your status is now visible to that circle.' : 'Your status is visible to all friends.', 'success');
    } catch (error) {
      toast(error.message || 'Status visibility could not be changed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="availability-control">
      <Button
        className="availability-trigger"
        variant="secondary"
        size="sm"
        aria-expanded={open}
        aria-label={`Hangout status${current ? `: ${OPTIONS.find(([value]) => value === current.state)?.[1] ?? current.state}` : ''}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`availability-status-dot${current ? ` availability-${current.state}` : ''}`} />
        <span>{current ? OPTIONS.find(([value]) => value === current.state)?.[1] : 'Set status'}</span>
        <ChevronDown size={14} />
      </Button>
      {open && (
        <div className="availability-popover" role="dialog" aria-label="Set your hangout status">
          <div className="availability-popover-heading"><strong>Hangout status</strong><button type="button" aria-label="Close status menu" onClick={() => setOpen(false)}><X size={16} /></button></div>
          <label className="availability-note-label">Optional note
            <input value={note} maxLength={60} onChange={(event) => setNote(event.target.value)} placeholder="What are you up to?" />
            <small>{note.length}/60</small>
          </label>
          <div className="availability-option-list">
            {OPTIONS.map(([value, label]) => (
              <button type="button" key={value} disabled={saving} onClick={() => update(value, value === 'free_tonight' ? minutesUntilTonight() : 60)}>
                <span className={`availability-status-dot availability-${value}`} />{label}
                {current?.state === value && <Check size={15} />}
              </button>
            ))}
          </div>
          <div className="availability-duration">
            <Clock3 size={14} /><span>Expires in</span>
            <button type="button" disabled={saving || !current} onClick={() => current && update(current.state, 60)}>1 hour</button>
            <button type="button" disabled={saving || !current} onClick={() => current && update(current.state, minutesUntilTonight())}>Tonight</button>
            <button type="button" disabled={saving || !current} onClick={() => current && update(current.state, 1440)}>24 hours</button>
          </div>
          {current && <label className="availability-circle-visibility">Visible to
            <select value={current.visible_to_circle_id ?? ''} disabled={saving || circles.isLoading} onChange={(event) => setVisibility(event.target.value)}>
              <option value="">All friends</option>
              {circles.data?.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}
            </select>
          </label>}
          {circles.isError && <p className="availability-error" role="alert">{circles.error.message || 'Circles could not be loaded.'}</p>}
          {current && <Button size="sm" variant="secondary" disabled={saving} onClick={clear}>Clear status</Button>}
          {own.isError && <p className="availability-error">{own.error.message || 'Your status could not be loaded.'}</p>}
        </div>
      )}
    </div>
  );
}
