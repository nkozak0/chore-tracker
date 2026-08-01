export const PROFILE_STORAGE_KEY = "chore-tracker.profile-id";

export function getSelectedProfileId() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(PROFILE_STORAGE_KEY);
}

export function selectProfile(profileId: string) {
  window.localStorage.setItem(PROFILE_STORAGE_KEY, profileId);
}

export function clearSelectedProfile() {
  window.localStorage.removeItem(PROFILE_STORAGE_KEY);
}
