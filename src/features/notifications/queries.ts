import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchNotifications, markNotificationsRead, type AppNotification } from './api'

export const notificationKeys = {
  all: ['notifications'] as const,
}

export function useNotifications() {
  return useQuery({ queryKey: notificationKeys.all, queryFn: fetchNotifications })
}

/** How many you haven't seen, for the bell. */
export function useUnreadNotifications() {
  return useQuery({
    queryKey: notificationKeys.all,
    queryFn: fetchNotifications,
    select: (list) => list.filter((n) => !n.read).length,
  })
}

/** The bell's count clears at once; the server follows. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: markNotificationsRead,
    onMutate: () =>
      qc.setQueryData<AppNotification[]>(notificationKeys.all, (list) => list?.map((n) => ({ ...n, read: true }))),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  })
}
