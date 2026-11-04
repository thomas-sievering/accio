import { useProfiles } from './profiles';

/** Quiet context in pane headers, only when there is more than one profile. */
export function ProfileLabel({ profileId }: { profileId?: string }) {
  const { profiles = [] } = useProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (profiles.length <= 1 || !profile) return null;
  return <span className="profile-label" title={`Profile: ${profile.name}`} aria-label={`Profile: ${profile.name}`}>{profile.name}</span>;
}
