import { supabase } from './supabase';

export async function fetchProfile(userId) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, username, bio, location, photo_url, role, status, last_seen, onboarding_completed, created_at')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function checkUsernameAvailability(username) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('username_available', {
    p_username: username,
  });
  if (error) throw error;
  return data === true;
}
