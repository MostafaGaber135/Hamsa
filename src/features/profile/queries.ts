import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { conversationKeys } from '@/features/conversations/queries'
import { friendKeys } from '@/features/friends/queries'
import {
  USERNAME_PATTERN,
  changePassword,
  deleteAccount,
  isUsernameAvailable,
  removeAvatar,
  updateProfile,
  uploadAvatar,
} from './api'

/** Your name and photo also appear in conversations and friend lists, so refresh those too. */
function useRefreshEverywhere(userId: string) {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: conversationKeys.profile(userId) }),
      qc.invalidateQueries({ queryKey: conversationKeys.all }),
      qc.invalidateQueries({ queryKey: friendKeys.all }),
    ])
}

export function useUpdateProfile(userId: string) {
  const refresh = useRefreshEverywhere(userId)
  return useMutation({
    mutationFn: (fields: { fullName: string; username: string }) => updateProfile(userId, fields),
    onSuccess: refresh,
  })
}

export function useAvatar(userId: string) {
  const refresh = useRefreshEverywhere(userId)
  const upload = useMutation({
    mutationFn: ({ file, previousUrl }: { file: File; previousUrl?: string | null }) =>
      uploadAvatar(userId, file, previousUrl),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (previousUrl?: string | null) => removeAvatar(userId, previousUrl),
    onSuccess: refresh,
  })
  return { upload, remove }
}

export function useDeleteAccount() {
  return useMutation({ mutationFn: deleteAccount })
}

export function useChangePassword() {
  return useMutation({ mutationFn: changePassword })
}

/** Checks the username only when it differs from yours and has a valid shape. */
export function useUsernameAvailability(username: string, current: string, userId: string) {
  const shouldCheck = username !== current && USERNAME_PATTERN.test(username)
  return useQuery({
    queryKey: ['username-available', username],
    queryFn: () => isUsernameAvailable(username, userId),
    enabled: shouldCheck,
    staleTime: 10_000,
  })
}
