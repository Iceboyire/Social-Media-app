import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

export function invalidateFriendshipQueries(queryClient, userId) {
  if (!userId) return Promise.resolve();
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['friendships', userId] }),
    queryClient.invalidateQueries({ queryKey: ['friend-requests', userId] }),
    queryClient.invalidateQueries({ queryKey: ['app-counts', userId] }),
    queryClient.invalidateQueries({ queryKey: ['friends', userId] }),
    queryClient.invalidateQueries({ queryKey: ['group-friend-profiles', userId] }),
    queryClient.invalidateQueries({ queryKey: ['user-search', userId] }),
    queryClient.invalidateQueries({ queryKey: ['public-profile'] }),
    queryClient.invalidateQueries({ queryKey: ['blocked-users', userId] }),
  ]);
}

export function useFriendshipRealtime() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (!user?.id || !supabase) return undefined;
    const channel = supabase
      .channel(`friendships-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'friendships',
      }, () => { invalidateFriendshipQueries(queryClient, user.id); })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          toast('Live friend updates are temporarily unavailable. Refresh to see the latest changes.');
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, queryClient, toast]);
}
