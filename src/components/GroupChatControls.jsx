import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Crown, Search, Shield, UserMinus, UserPlus, UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';
import { invalidateFriendshipQueries } from '../hooks/useFriendshipRealtime';

const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

async function fetchFriends(userId) {
  const { data: rows, error } = await supabase.from('friendships')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
  if (error) throw error;
  const ids = [...new Set((rows ?? []).map((row) => row.requester_id === userId ? row.addressee_id : row.requester_id))];
  if (!ids.length) return [];
  const { data, error: profilesError } = await supabase.from('profiles')
    .select('id, name, username, photo_url')
    .in('id', ids)
    .order('name');
  if (profilesError) throw profilesError;
  return data ?? [];
}

export function NewGroupModal({ open, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [memberIds, setMemberIds] = useState([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const friendsQuery = useQuery({
    queryKey: ['group-friend-profiles', user?.id],
    queryFn: () => fetchFriends(user.id),
    enabled: Boolean(open && user?.id),
    retry: 1,
  });

  useEffect(() => () => {
    if (photoPreview.startsWith('blob:')) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  function choosePhoto(file) {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      toast('Choose a JPG, PNG, WebP, or GIF group photo.');
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
      toast('Group photos must be 5 MB or smaller.');
      return;
    }
    if (photoPreview.startsWith('blob:')) URL.revokeObjectURL(photoPreview);
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function close() {
    if (saving) return;
    setName('');
    setPhoto(null);
    if (photoPreview.startsWith('blob:')) URL.revokeObjectURL(photoPreview);
    setPhotoPreview('');
    setMemberIds([]);
    setSearch('');
    onClose();
  }

  async function createGroup(event) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      let photoUrl = null;
      if (photo) {
        const extension = photo.type === 'image/png' ? 'png' : photo.type === 'image/webp' ? 'webp' : photo.type === 'image/gif' ? 'gif' : 'jpg';
        const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from('group-photos').upload(path, photo, {
          contentType: photo.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from('group-photos').getPublicUrl(path);
        if (!data?.publicUrl) throw new Error('The group photo uploaded, but its public URL could not be created.');
        photoUrl = data.publicUrl;
      }
      const { data: conversationId, error } = await supabase.rpc('create_group', {
        name: name.trim(),
        photo_url: photoUrl,
        member_ids: memberIds,
      });
      if (error) throw error;
      if (!conversationId) throw new Error('The group could not be created.');
      toast('Your group is ready.', 'success');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['conversations', user.id] }),
        invalidateFriendshipQueries(queryClient, user.id),
      ]);
      close();
      navigate(`/messages/${conversationId}`);
    } catch (error) {
      toast(error.message || 'The group could not be created.');
    } finally {
      setSaving(false);
    }
  }

  const matchingFriends = (friendsQuery.data ?? []).filter((friend) => (
    `${friend.name} ${friend.username}`.toLowerCase().includes(search.trim().toLowerCase())
  ));

  return (
    <Modal open={open} onClose={close} title="Create a group" size="md">
      <form className="group-modal-form" onSubmit={createGroup}>
        <Input id="new-group-name" label="Group name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Weekend crew" required autoFocus />
        <div className="group-photo-picker">
          {photoPreview
            ? <img src={photoPreview} alt="Group photo preview" />
            : <span className="group-photo-placeholder"><Camera size={21} /></span>}
          <label className="ui-button ui-button-secondary ui-button-sm" htmlFor="new-group-photo">{photoPreview ? 'Change photo' : 'Add photo'}</label>
          <input id="new-group-photo" type="file" accept={PHOTO_TYPES.join(',')} hidden onChange={(event) => { choosePhoto(event.target.files?.[0]); event.target.value = ''; }} />
          <small>Optional · Up to 5 MB</small>
        </div>
        <div className="group-friend-picker">
          <div><strong>Add friends</strong><small>Choose friends to add to the group.</small></div>
          <label className="app-search-wrap group-friend-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search friends" aria-label="Search friends" /></label>
          <div className="group-friend-list">
            {friendsQuery.isLoading && <p className="group-picker-message">Loading friends…</p>}
            {friendsQuery.isError && <p className="group-picker-error">{friendsQuery.error.message || 'Friends could not be loaded.'}</p>}
            {friendsQuery.isSuccess && matchingFriends.length === 0 && <p className="group-picker-message">No friends found to add.</p>}
            {matchingFriends.map((friend) => (
              <label className="group-friend-option" key={friend.id}>
                <input type="checkbox" checked={memberIds.includes(friend.id)} onChange={() => setMemberIds((current) => current.includes(friend.id) ? current.filter((id) => id !== friend.id) : [...current, friend.id])} />
                <Avatar src={friend.photo_url} name={friend.name} size="xs" />
                <span><strong>{friend.name}</strong><small>@{friend.username}</small></span>
              </label>
            ))}
          </div>
          <small>{memberIds.length} selected</small>
        </div>
        <footer className="ui-modal-actions">
          <Button type="button" variant="secondary" onClick={close} disabled={saving}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!name.trim()}><UsersRound size={15} /> Create group</Button>
        </footer>
      </form>
    </Modal>
  );
}

export function GroupInfoPanel({ open, onClose, conversation, members, profiles, userId }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [name, setName] = useState(conversation?.name ?? '');
  const [busyKey, setBusyKey] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const friendsQuery = useQuery({
    queryKey: ['group-friend-profiles', userId],
    queryFn: () => fetchFriends(userId),
    enabled: Boolean(open && userId),
    retry: 1,
  });
  const self = members.find((member) => member.user_id === userId);
  const isAdmin = self?.role === 'admin';
  const activeMemberIds = new Set(members.map((member) => member.user_id));
  const addableFriends = (friendsQuery.data ?? []).filter((friend) => (
    !activeMemberIds.has(friend.id) && `${friend.name} ${friend.username}`.toLowerCase().includes(search.trim().toLowerCase())
  ));

  useEffect(() => { setName(conversation?.name ?? ''); }, [conversation?.name]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['conversation-details', conversation?.id, userId] }),
      queryClient.invalidateQueries({ queryKey: ['conversations', userId] }),
      queryClient.invalidateQueries({ queryKey: ['conversation-messages', conversation?.id, userId] }),
    ]);
  }

  async function runAction(key, rpc, args, success) {
    if (busyKey) return false;
    setBusyKey(key);
    try {
      const { error } = await supabase.rpc(rpc, args);
      if (error) throw error;
      toast(success, 'success');
      await refresh();
      return true;
    } catch (error) {
      toast(error.message || 'The group could not be updated.');
      await refresh();
      return false;
    } finally {
      setBusyKey('');
    }
  }

  async function chooseGroupPhoto(file) {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type) || file.size > MAX_PHOTO_SIZE) {
      toast('Choose a JPG, PNG, WebP, or GIF photo up to 5 MB.');
      return;
    }
    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : 'jpg';
    const path = `${userId}/${crypto.randomUUID()}.${extension}`;
    setBusyKey('photo');
    try {
      const { error: uploadError } = await supabase.storage.from('group-photos').upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('group-photos').getPublicUrl(path);
      if (!data?.publicUrl) throw new Error('The photo uploaded, but its URL could not be created.');
      const { error } = await supabase.rpc('set_group_photo', { conversation: conversation.id, photo_url: data.publicUrl });
      if (error) throw error;
      toast('Group photo updated.', 'success');
      await refresh();
    } catch (error) {
      toast(error.message || 'Group photo could not be updated.');
    } finally {
      setBusyKey('');
    }
  }

  async function confirm() {
    if (!confirmAction) return;
    const { action, member } = confirmAction;
    const ok = await runAction(
      `${action}-${member?.user_id ?? 'self'}`,
      action === 'leave' ? 'leave_group' : 'remove_group_member',
      action === 'leave' ? { conversation: conversation.id } : { conversation: conversation.id, user: member.user_id },
      action === 'leave' ? 'You left the group.' : `${profiles[member.user_id]?.name || 'Member'} was removed from the group.`,
    );
    if (ok) {
      setConfirmAction(null);
      if (action === 'leave') onClose(true);
    }
  }

  return (
    <>
      <Modal open={open} onClose={() => onClose(false)} title="Group info" size="md">
        <div className="group-info-content">
          {conversation?.photo_url && <img className="group-info-photo" src={conversation.photo_url} alt={`${conversation.name} group`} />}
          <p className="settings-card-intro">{members.length} {members.length === 1 ? 'member' : 'members'}</p>
          {isAdmin && (
            <div className="group-admin-tools">
              <div className="group-photo-picker">
                {conversation?.photo_url ? <img src={conversation.photo_url} alt="" /> : <span className="group-photo-placeholder"><Camera size={20} /></span>}
                <label className={`ui-button ui-button-secondary ui-button-sm${busyKey === 'photo' ? ' group-upload-busy' : ''}`} htmlFor="group-info-photo">{busyKey === 'photo' ? 'Uploading…' : 'Change photo'}</label>
                <input id="group-info-photo" type="file" accept={PHOTO_TYPES.join(',')} hidden disabled={Boolean(busyKey)} onChange={(event) => { chooseGroupPhoto(event.target.files?.[0]); event.target.value = ''; }} />
              </div>
              <form className="group-rename-form" onSubmit={async (event) => { event.preventDefault(); if (name.trim() && name.trim() !== conversation.name) await runAction('rename', 'rename_group', { conversation: conversation.id, name: name.trim() }, 'Group name updated.'); }}>
                <Input id="group-rename" label="Group name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
                <Button size="sm" type="submit" loading={busyKey === 'rename'} disabled={!name.trim() || name.trim() === conversation?.name}>Save</Button>
              </form>
              <div className="group-add-member">
                <strong>Add a friend</strong>
                <label className="app-search-wrap group-friend-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your friends" aria-label="Search friends to add" /></label>
                {friendsQuery.isError && <p className="group-picker-error">{friendsQuery.error.message || 'Friends could not be loaded.'}</p>}
                <div className="group-add-results">
                  {addableFriends.map((friend) => <div className="group-friend-option" key={friend.id}><Avatar src={friend.photo_url} name={friend.name} size="xs" /><span><strong>{friend.name}</strong><small>@{friend.username}</small></span><Button size="sm" onClick={() => runAction(`add-${friend.id}`, 'add_group_member', { conversation: conversation.id, user: friend.id }, `${friend.name} was added to the group.`)} loading={busyKey === `add-${friend.id}`}><UserPlus size={13} /> Add</Button></div>)}
                  {friendsQuery.isSuccess && addableFriends.length === 0 && <p className="group-picker-message">No friends available to add.</p>}
                </div>
              </div>
            </div>
          )}
          <div className="group-member-list">
            {members.map((member) => {
              const profile = profiles[member.user_id];
              if (!profile) return null;
              return <div className="group-member-row" key={member.user_id}>
                <Avatar src={profile.photo_url} name={profile.name} size="sm" />
                <span><strong>{profile.name}{member.user_id === userId ? ' (you)' : ''}</strong><small>@{profile.username}</small></span>
                {member.role === 'admin'
                  ? <span className="group-admin-badge"><Crown size={12} /> Admin</span>
                  : isAdmin && <Button size="sm" variant="secondary" disabled={Boolean(busyKey)} onClick={() => runAction(`admin-${member.user_id}`, 'make_group_admin', { conversation: conversation.id, user: member.user_id }, `${profile.name} is now an admin.`)}><Shield size={13} /> Make admin</Button>}
                {isAdmin && member.user_id !== userId && <Button size="sm" variant="secondary" aria-label={`Remove ${profile.name}`} disabled={Boolean(busyKey)} onClick={() => setConfirmAction({ action: 'remove', member })}><UserMinus size={14} /></Button>}
              </div>;
            })}
          </div>
          <footer className="group-info-footer">
            <Button variant="danger" onClick={() => setConfirmAction({ action: 'leave' })}><UserMinus size={15} /> Leave group</Button>
            <Button variant="secondary" onClick={() => onClose(false)}>Done</Button>
          </footer>
        </div>
      </Modal>
      <ConfirmDialog
        open={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={confirm}
        title={confirmAction?.action === 'leave' ? 'Leave this group?' : 'Remove this member?'}
        message={confirmAction?.action === 'leave' ? 'You will no longer receive messages from this group.' : `Remove ${profiles[confirmAction?.member?.user_id]?.name || 'this member'} from the group?`}
        confirmLabel={confirmAction?.action === 'leave' ? 'Leave group' : 'Remove member'}
        destructive
        loading={Boolean(busyKey)}
      />
    </>
  );
}
