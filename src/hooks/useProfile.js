import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../providers/AuthProvider';
import { fetchProfile } from '../lib/profile';
import { supabase } from '../lib/supabase';

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => fetchProfile(user.id),
    enabled: Boolean(user?.id),
    retry: 1,
  });
}

export function useUpdateProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (changes) => {
      if (!supabase || !user) throw new Error('You need to sign in first.');
      const { data, error } = await supabase
        .from('profiles')
        .update(changes)
        .eq('id', user.id)
        .select('id, name, username, bio, location, photo_url, role, status, last_seen, onboarding_completed, created_at')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async (profile) => {
      queryClient.setQueryData(['profile', user.id], profile);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['public-profile'] }),
        queryClient.invalidateQueries({ queryKey: ['user-search', user.id] }),
      ]);
    },
  });
}
