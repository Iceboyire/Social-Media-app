import { supabase } from './supabase';

export async function uploadAvatar(userId, imageBlob) {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!userId || !imageBlob) throw new Error('Choose a photo before uploading.');
  const extension = imageBlob.type === 'image/png' ? 'png' : 'jpg';
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, imageBlob, {
      contentType: imageBlob.type,
      cacheControl: '3600',
      upsert: false,
    });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('The photo uploaded, but its public URL could not be created.');
  return data.publicUrl;
}
