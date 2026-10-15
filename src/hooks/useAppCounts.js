import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

async function fetchCounts(userId) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const [friends, messages, notifications] = await Promise.all([
    supabase
      .from('friendships')
      .select('id', { count: 'exact', head: true })
      .eq('addressee_id', userId)
      .eq('status', 'pending'),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .eq('type', 'new_message'),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false),
  ]);

  for (const result of [friends, messages, notifications]) {
    if (result.error) throw result.error;
  }

  return {
    friends: friends.count ?? 0,
    messages: messages.count ?? 0,
    notifications: notifications.count ?? 0,
  };
}

export function useAppCounts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: ['app-counts', user?.id],
    queryFn: () => fetchCounts(user.id),
    enabled: Boolean(user?.id),
    refetchInterval: 30_000,
    retry: 1,
  });

  useEffect(() => {
    if (!user?.id || !supabase) return undefined;
    const channel = supabase
      .channel(`app-counts-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => queryClient.invalidateQueries({ queryKey: ['app-counts', user.id] }))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'friendships',
        filter: `addressee_id=eq.${user.id}`,
      }, () => queryClient.invalidateQueries({ queryKey: ['app-counts', user.id] }))
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          toast('Live badge updates are temporarily unavailable. Counts will refresh periodically.');
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, queryClient, toast]);

  return query;
}
