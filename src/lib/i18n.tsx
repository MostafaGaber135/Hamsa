import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'ar'

const strings = {
  en: {
    search: 'Search chats or people',
    newChat: 'New chat',
    filterAll: 'All',
    filterUnread: 'Unread',
    filterUnreadCount: (n: string) => `Unread · ${n}`,
    filterGroups: 'Groups',
    conversations: 'Conversations',
    online: 'online',
    lastSeen: (time: string) => `last seen ${time}`,
    typing: 'typing',
    isTyping: (name: string) => `${name} is typing…`,
    writeMessage: 'Write a message…',
    messageTo: (name: string) => `Message ${name}`,
    send: 'Send',
    attach: 'Attach image',
    emoji: 'Emoji',
    retry: 'Click to retry',
    today: 'Today',
    yesterday: 'Yesterday',
    status: { sending: 'Sending', sent: 'Sent', read: 'Read', failed: 'Not sent' },
    photo: '📷 Photo',
    you: 'You',
    back: 'Back to conversations',
    more: 'Conversation actions',
    emptyTitle: 'Nothing open yet',
    emptyBody: 'Pick a conversation from the list, or start a new one.',
    noResults: 'No conversations match your search.',
    themeToDark: 'Switch to dark theme',
    themeToLight: 'Switch to light theme',
    switchLanguage: 'التبديل إلى العربية',
    available: 'Available',
    signOut: 'Sign out',
    auth: {
      signInTitle: 'Sign in to Hamsa',
      signUpTitle: 'Create your account',
      subtitle: 'Quiet, real-time conversations.',
      fullName: 'Full name',
      email: 'Email',
      password: 'Password',
      passwordHint: 'At least 8 characters',
      signIn: 'Sign in',
      signUp: 'Create account',
      google: 'Continue with Google',
      or: 'or',
      toSignUp: "Don't have an account?",
      toSignIn: 'Already have an account?',
      switchToSignUp: 'Create one',
      switchToSignIn: 'Sign in',
      checkEmail: (email: string) => `Check ${email} for a link to confirm your account, then sign in.`,
    },
    newChatDialog: {
      title: 'New chat',
      searchPeople: 'Search by name or username',
      noPeople: 'No one matches that search.',
      typeToSearch: 'Type a name to find people.',
      groupName: 'Group name',
      startChat: 'Start chat',
      createGroup: 'Create group',
      cancel: 'Cancel',
      remove: (name: string) => `Remove ${name}`,
    },
    friends: {
      title: 'Friends',
      open: 'Friends',
      tabFriends: 'Friends',
      tabRequests: 'Requests',
      tabFind: 'Find people',
      search: 'Search by name or username',
      typeToSearch: 'Type a name to find people on Hamsa.',
      noResults: 'No one matches that search.',
      noFriends: 'No friends yet. Find people and send them a request.',
      noRequests: 'No requests right now.',
      incoming: 'Received',
      outgoing: 'Sent',
      add: 'Add friend',
      accept: 'Accept',
      decline: 'Decline',
      cancel: 'Cancel request',
      remove: 'Remove',
      message: 'Message',
      isFriend: 'Friends',
      removeConfirm: (name: string) => `Remove ${name} from your friends?`,
    },
    profile: {
      title: 'My profile',
      open: 'Open my profile',
      photo: 'Profile photo',
      changePhoto: 'Change photo',
      removePhoto: 'Remove photo',
      photoHint: 'JPG, PNG or WebP. It will be cropped to a square.',
      photoTooBig: 'Choose an image smaller than 10 MB.',
      photoWrongType: 'Choose an image file (JPG, PNG or WebP).',
      details: 'Your details',
      fullName: 'Full name',
      username: 'Username',
      usernameHint: '3–24 characters: lowercase letters, numbers and _',
      usernameChecking: 'Checking…',
      usernameAvailable: 'Available',
      usernameTaken: 'That username is taken. Try another one.',
      email: 'Email',
      emailHint: "Your sign-in email. It can't be changed here.",
      save: 'Save changes',
      saved: 'Saved',
      password: 'Password',
      changePassword: 'Change password',
      setPassword: 'Set a password',
      setPasswordHint: 'You signed in with Google. A password lets you also sign in with your email.',
      newPassword: 'New password',
      confirmPassword: 'Confirm new password',
      passwordMismatch: "The passwords don't match.",
      passwordUpdated: 'Password updated',
    },
    menu: {
      pin: 'Pin to top',
      unpin: 'Unpin',
      mute: 'Mute',
      unmute: 'Unmute',
      markRead: 'Mark as read',
      markUnread: 'Mark as unread',
      delete: 'Delete chat',
      leave: 'Leave group',
      deleteConfirm: (name: string) => `Delete your chat with ${name}? Messages disappear for you only. It comes back if someone sends a new message.`,
      leaveConfirm: (name: string) => `Leave ${name}? You won't get its messages anymore.`,
      pinned: 'Pinned',
      unread: 'Unread',
    },
    composer: {
      removeImage: 'Remove image',
      imageTooBig: 'Choose an image smaller than 20 MB.',
      imageWrongType: 'Only images can be sent (JPG, PNG, WebP, GIF).',
      emojiPicker: 'Emoji',
      insert: (emoji: string) => `Insert ${emoji}`,
    },
    newMessages: (n: string) => `${n} new`,
    reconnecting: 'Reconnecting…',
    offline: "You're offline. Messages will send when you're back.",
    privacy: 'Privacy policy',
    backToApp: 'Back to Hamsa',
    loadEarlier: 'Load earlier messages',
    loading: 'Loading…',
    loadError: "Couldn't load this. Check your connection and try again.",
    tryAgain: 'Try again',
    noConversations: 'No conversations yet. Start one with New chat.',
  },
  ar: {
    search: 'ابحث في المحادثات أو الأشخاص',
    newChat: 'محادثة جديدة',
    filterAll: 'الكل',
    filterUnread: 'غير مقروءة',
    filterUnreadCount: (n: string) => `غير مقروءة (${n})`,
    filterGroups: 'المجموعات',
    conversations: 'المحادثات',
    online: 'متصل الآن',
    lastSeen: (time: string) => `آخر ظهور ${time}`,
    typing: 'يكتب',
    isTyping: (name: string) => `${name} يكتب…`,
    writeMessage: 'اكتب رسالة…',
    messageTo: (name: string) => `رسالة إلى ${name}`,
    send: 'إرسال',
    attach: 'إرفاق صورة',
    emoji: 'رموز تعبيرية',
    retry: 'اضغط لإعادة المحاولة',
    today: 'اليوم',
    yesterday: 'أمس',
    status: { sending: 'جارٍ الإرسال', sent: 'تم الإرسال', read: 'تمت القراءة', failed: 'لم تُرسل' },
    photo: '📷 صورة',
    you: 'أنت',
    back: 'العودة إلى المحادثات',
    more: 'خيارات المحادثة',
    emptyTitle: 'لا توجد محادثة مفتوحة',
    emptyBody: 'اختر محادثة من القائمة، أو ابدأ محادثة جديدة.',
    noResults: 'لا توجد محادثات تطابق بحثك.',
    themeToDark: 'التبديل إلى الوضع الداكن',
    themeToLight: 'التبديل إلى الوضع الفاتح',
    switchLanguage: 'Switch to English',
    available: 'متاح',
    signOut: 'تسجيل الخروج',
    auth: {
      signInTitle: 'سجّل الدخول إلى همسة',
      signUpTitle: 'أنشئ حسابك',
      subtitle: 'محادثات هادئة، في الوقت الفعلي.',
      fullName: 'الاسم الكامل',
      email: 'البريد الإلكتروني',
      password: 'كلمة المرور',
      passwordHint: '٨ أحرف على الأقل',
      signIn: 'تسجيل الدخول',
      signUp: 'إنشاء حساب',
      google: 'المتابعة باستخدام Google',
      or: 'أو',
      toSignUp: 'ليس لديك حساب؟',
      toSignIn: 'لديك حساب بالفعل؟',
      switchToSignUp: 'أنشئ حسابًا',
      switchToSignIn: 'سجّل الدخول',
      checkEmail: (email: string) => `افتح بريدك ${email} وأكّد حسابك من الرابط، ثم سجّل الدخول.`,
    },
    newChatDialog: {
      title: 'محادثة جديدة',
      searchPeople: 'ابحث بالاسم أو اسم المستخدم',
      noPeople: 'لا يوجد أحد بهذا الاسم.',
      typeToSearch: 'اكتب اسمًا للبحث عن الأشخاص.',
      groupName: 'اسم المجموعة',
      startChat: 'ابدأ المحادثة',
      createGroup: 'أنشئ المجموعة',
      cancel: 'إلغاء',
      remove: (name: string) => `إزالة ${name}`,
    },
    friends: {
      title: 'الأصدقاء',
      open: 'الأصدقاء',
      tabFriends: 'الأصدقاء',
      tabRequests: 'الطلبات',
      tabFind: 'البحث عن أشخاص',
      search: 'ابحث بالاسم أو اسم المستخدم',
      typeToSearch: 'اكتب اسمًا للبحث عن أشخاص على همسة.',
      noResults: 'لا يوجد أحد بهذا الاسم.',
      noFriends: 'لا يوجد أصدقاء بعد. ابحث عن أشخاص وأرسل لهم طلبًا.',
      noRequests: 'لا توجد طلبات الآن.',
      incoming: 'المستلمة',
      outgoing: 'المرسلة',
      add: 'إضافة صديق',
      accept: 'قبول',
      decline: 'رفض',
      cancel: 'إلغاء الطلب',
      remove: 'إزالة',
      message: 'مراسلة',
      isFriend: 'أصدقاء',
      removeConfirm: (name: string) => `إزالة ${name} من أصدقائك؟`,
    },
    profile: {
      title: 'ملفي الشخصي',
      open: 'فتح ملفي الشخصي',
      photo: 'الصورة الشخصية',
      changePhoto: 'تغيير الصورة',
      removePhoto: 'إزالة الصورة',
      photoHint: 'JPG أو PNG أو WebP، وسيتم قصّها بشكل مربع.',
      photoTooBig: 'اختر صورة أصغر من ١٠ ميجابايت.',
      photoWrongType: 'اختر ملف صورة (JPG أو PNG أو WebP).',
      details: 'بياناتك',
      fullName: 'الاسم الكامل',
      username: 'اسم المستخدم',
      usernameHint: 'من ٣ إلى ٢٤ حرفًا: حروف إنجليزية صغيرة وأرقام و _',
      usernameChecking: 'جارٍ التحقق…',
      usernameAvailable: 'متاح',
      usernameTaken: 'اسم المستخدم هذا مستخدم بالفعل، جرّب اسمًا آخر.',
      email: 'البريد الإلكتروني',
      emailHint: 'بريد تسجيل الدخول، ولا يمكن تغييره من هنا.',
      save: 'حفظ التغييرات',
      saved: 'تم الحفظ',
      password: 'كلمة المرور',
      changePassword: 'تغيير كلمة المرور',
      setPassword: 'تعيين كلمة مرور',
      setPasswordHint: 'سجّلت الدخول عبر Google. كلمة المرور تتيح لك تسجيل الدخول ببريدك أيضًا.',
      newPassword: 'كلمة المرور الجديدة',
      confirmPassword: 'تأكيد كلمة المرور الجديدة',
      passwordMismatch: 'كلمتا المرور غير متطابقتين.',
      passwordUpdated: 'تم تحديث كلمة المرور',
    },
    menu: {
      pin: 'تثبيت في الأعلى',
      unpin: 'إلغاء التثبيت',
      mute: 'كتم',
      unmute: 'إلغاء الكتم',
      markRead: 'تعليم كمقروءة',
      markUnread: 'تعليم كغير مقروءة',
      delete: 'حذف المحادثة',
      leave: 'مغادرة المجموعة',
      deleteConfirm: (name: string) => `حذف محادثتك مع ${name}؟ ستختفي الرسائل عندك فقط، وتعود المحادثة إذا وصلت رسالة جديدة.`,
      leaveConfirm: (name: string) => `مغادرة ${name}؟ لن تصلك رسائلها بعد الآن.`,
      pinned: 'مثبّتة',
      unread: 'غير مقروءة',
    },
    composer: {
      removeImage: 'إزالة الصورة',
      imageTooBig: 'اختر صورة أصغر من ٢٠ ميجابايت.',
      imageWrongType: 'يمكن إرسال الصور فقط (JPG أو PNG أو WebP أو GIF).',
      emojiPicker: 'الرموز التعبيرية',
      insert: (emoji: string) => `إدراج ${emoji}`,
    },
    newMessages: (n: string) => `${n} جديدة`,
    reconnecting: 'جارٍ إعادة الاتصال…',
    offline: 'أنت غير متصل. سترسَل الرسائل عند عودة الاتصال.',
    privacy: 'سياسة الخصوصية',
    backToApp: 'العودة إلى همسة',
    loadEarlier: 'تحميل الرسائل الأقدم',
    loading: 'جارٍ التحميل…',
    loadError: 'تعذّر التحميل. تحقق من اتصالك وحاول مرة أخرى.',
    tryAgain: 'حاول مرة أخرى',
    noConversations: 'لا توجد محادثات بعد. ابدأ واحدة من «محادثة جديدة».',
  },
} satisfies Record<Lang, unknown>

export type Strings = (typeof strings)['en']

// Arabic uses Arabic-Indic digits and ص/م, per the design system.
const intlLocale: Record<Lang, string> = { en: 'en-GB', ar: 'ar-EG' }

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function daysBetween(a: Date, b: Date) {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000)
}

function makeFormatters(lang: Lang, t: Strings) {
  const locale = intlLocale[lang]
  const time = new Intl.DateTimeFormat(locale, {
    hour: lang === 'ar' ? 'numeric' : '2-digit',
    minute: '2-digit',
    hour12: lang === 'ar',
  })
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' })
  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
  const dayMonthYear = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  const number = new Intl.NumberFormat(locale)

  /** "Today", "Yesterday", "Monday", "Sep 12", "Sep 12, 2025" */
  function day(iso: string, now = new Date()) {
    const d = new Date(iso)
    const diff = daysBetween(d, now)
    if (diff === 0) return t.today
    if (diff === 1) return t.yesterday
    if (diff < 7) return weekday.format(d)
    return d.getFullYear() === now.getFullYear() ? dayMonth.format(d) : dayMonthYear.format(d)
  }

  return {
    /** "10:48" / "١٠:٤٨ ص" */
    time: (iso: string) => time.format(new Date(iso)),
    day,
    /** Conversation list: time today, otherwise the day label. */
    listTime: (iso: string, now = new Date()) =>
      daysBetween(new Date(iso), now) === 0 ? time.format(new Date(iso)) : day(iso, now),
    number: (n: number) => number.format(n),
    sameDay: (a: string, b: string) => daysBetween(new Date(a), new Date(b)) === 0,
  }
}

interface LocaleValue {
  lang: Lang
  dir: 'ltr' | 'rtl'
  t: Strings
  fmt: ReturnType<typeof makeFormatters>
  setLang: (lang: Lang) => void
}

const LocaleContext = createContext<LocaleValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem('hamsa:lang') === 'ar' ? 'ar' : 'en'
    } catch {
      return 'en'
    }
  })
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  // Set lang and dir on <html> so logical CSS and the rtl: variant mirror everything.
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = dir
    try {
      localStorage.setItem('hamsa:lang', lang)
    } catch {
      /* ignore */
    }
  }, [lang, dir])

  const value = useMemo<LocaleValue>(() => {
    const t = strings[lang]
    return { lang, dir, t, fmt: makeFormatters(lang, t), setLang }
  }, [lang, dir])

  return <LocaleContext value={value}>{children}</LocaleContext>
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used inside <LocaleProvider>')
  return ctx
}
