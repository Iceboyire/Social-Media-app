import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';

export function useAvailability() {
  const { user } = useAuth();
  const own = useQuery({
    queryKey: ['availability', 'own', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability')
        .select('state, note, expires_at, is_hidden, visible_to_circle_id, updated_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data && new Date(data.expires_at).getTime() > Date.now() ? data : null;
    },
    enabled: Boolean(user?.id),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const friends = useQuery({
    queryKey: ['availability', 'friends', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_friends_availability');
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(user?.id),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  return { own, friends };
}
