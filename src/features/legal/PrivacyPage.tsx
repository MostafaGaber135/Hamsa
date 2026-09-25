import { ArrowLeft, Languages } from 'lucide-react'
import { BrandMark } from '@/components/ui/BrandMark'
import { IconButton } from '@/components/ui/Button'
import { useLocale } from '@/lib/i18n'

const CONTACT_EMAIL = 'mostafagaber1234560@gmail.com'
const UPDATED = { en: 'September 24, 2026', ar: '٢٤ سبتمبر ٢٠٢٦' }

interface Section {
  title: string
  body: string[]
}

const content: Record<'en' | 'ar', { title: string; intro: string; updated: string; sections: Section[] }> = {
  en: {
    title: 'Privacy policy',
    updated: 'Last updated',
    intro:
      'Hamsa is a chat app built as a portfolio project by Mostafa Gaber. This page explains what information Hamsa keeps, why, and what you can do about it.',
    sections: [
      {
        title: 'What we collect',
        body: [
          'Your account: your name, email address, a username we create for you, and your password (stored only as a secure hash by our authentication provider, never readable by us).',
          'If you sign in with Google: your name, email address and profile photo. Hamsa asks Google for nothing else — not your contacts, files or calendar.',
          'What you do in Hamsa: your messages, images you send, the conversations and groups you are in, your friends and friend requests, and when you last read each conversation.',
        ],
      },
      {
        title: 'How we use it',
        body: [
          'Only to run Hamsa: to sign you in, show your conversations, deliver your messages, show read receipts and unread counts, and let people find you by name to add you as a friend.',
          'Hamsa has no ads, does not sell your data, and does not share it with anyone for marketing.',
        ],
      },
      {
        title: 'Who can see what',
        body: [
          'Your name, username and profile photo are visible to other signed-in Hamsa users, so they can find you.',
          'Messages and images are visible only to the members of that conversation. This is enforced by the database itself, not just by the app.',
          'Friend requests are visible only to the two people involved.',
        ],
      },
      {
        title: 'Where it is stored',
        body: [
          'Data is stored with Supabase, on servers in the European Union (Frankfurt). The app itself is hosted on Vercel.',
          'Your browser keeps your sign-in session and your theme and language choices so you stay signed in and see Hamsa the way you left it. Hamsa uses no tracking or advertising cookies.',
        ],
      },
      {
        title: 'Your choices',
        body: [
          `You can delete your account at any time from My profile → Delete account. It removes your profile, your messages, your one-to-one chats and your friendships straight away. For a copy of your data, email ${CONTACT_EMAIL}.`,
          'In My profile → Privacy you choose who sees when you’re online and your last seen, who can add you to groups, and who you’ve blocked.',
          'If you signed in with Google, you can also remove Hamsa’s access at any time from your Google Account, under Security → Third-party connections.',
        ],
      },
      {
        title: 'Changes and contact',
        body: [
          'If this policy changes, the date at the top of this page will change too.',
          `Questions? Email ${CONTACT_EMAIL}.`,
        ],
      },
    ],
  },
  ar: {
    title: 'سياسة الخصوصية',
    updated: 'آخر تحديث',
    intro:
      'همسة تطبيق محادثات بناه مصطفى جابر كمشروع ضمن معرض أعماله. توضح هذه الصفحة المعلومات التي تحتفظ بها همسة، وسبب ذلك، وما يمكنك فعله بشأنها.',
    sections: [
      {
        title: 'ما الذي نجمعه',
        body: [
          'حسابك: اسمك، وبريدك الإلكتروني، واسم مستخدم ننشئه لك، وكلمة المرور (تُحفظ فقط بصيغة مشفّرة لدى مزوّد تسجيل الدخول، ولا يمكننا قراءتها).',
          'إذا سجّلت الدخول عبر Google: اسمك، وبريدك الإلكتروني، وصورتك الشخصية. لا تطلب همسة من Google أي شيء آخر، لا جهات اتصالك ولا ملفاتك ولا تقويمك.',
          'ما تفعله في همسة: رسائلك، والصور التي ترسلها، والمحادثات والمجموعات التي تشارك فيها، وأصدقاؤك وطلبات الصداقة، ووقت آخر قراءة لكل محادثة.',
        ],
      },
      {
        title: 'كيف نستخدمه',
        body: [
          'لتشغيل همسة فقط: لتسجيل دخولك، وعرض محادثاتك، وتوصيل رسائلك، وإظهار علامات القراءة وعدد الرسائل غير المقروءة، ولتمكين الآخرين من العثور عليك بالاسم لإضافتك صديقًا.',
          'لا توجد إعلانات في همسة، ولا نبيع بياناتك، ولا نشاركها مع أحد لأغراض تسويقية.',
        ],
      },
      {
        title: 'من يرى ماذا',
        body: [
          'اسمك واسم المستخدم وصورتك الشخصية ظاهرة لمستخدمي همسة المسجّلين الآخرين حتى يتمكنوا من العثور عليك.',
          'الرسائل والصور لا يراها إلا أعضاء المحادثة نفسها، وقاعدة البيانات هي التي تفرض ذلك، وليس التطبيق وحده.',
          'طلبات الصداقة لا يراها إلا الشخصان المعنيّان.',
        ],
      },
      {
        title: 'أين تُحفظ البيانات',
        body: [
          'تُحفظ البيانات لدى Supabase على خوادم داخل الاتحاد الأوروبي (فرانكفورت)، ويُستضاف التطبيق نفسه على Vercel.',
          'يحتفظ متصفحك بجلسة تسجيل الدخول واختيارك للوضع واللغة، حتى تبقى مسجّلًا وتجد همسة كما تركتها. لا تستخدم همسة ملفات تعريف ارتباط للتتبّع أو الإعلانات.',
        ],
      },
      {
        title: 'خياراتك',
        body: [
          `يمكنك حذف حسابك في أي وقت من ملفي الشخصي ← حذف الحساب، فيُزال ملفك الشخصي ورسائلك ومحادثاتك الفردية وصداقاتك فورًا. للحصول على نسخة من بياناتك راسلنا على ${CONTACT_EMAIL}.`,
          'من ملفي الشخصي ← الخصوصية تختار من يرى حالة اتصالك وآخر ظهور لك، ومن يمكنه إضافتك إلى المجموعات، ومن حظرتهم.',
          'إذا سجّلت الدخول عبر Google، يمكنك أيضًا إلغاء وصول همسة في أي وقت من حسابك على Google، من الأمان ثم الاتصالات بجهات خارجية.',
        ],
      },
      {
        title: 'التغييرات والتواصل',
        body: [
          'إذا تغيّرت هذه السياسة، سيتغيّر التاريخ في أعلى الصفحة أيضًا.',
          `لديك سؤال؟ راسلنا على ${CONTACT_EMAIL}.`,
        ],
      },
    ],
  },
}

export function PrivacyPage() {
  const { t, lang, setLang } = useLocale()
  const c = content[lang]

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <a
          href="/"
          className="inline-flex items-center gap-2 rounded-xl px-2 py-1 text-body font-semibold text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <ArrowLeft size={18} strokeWidth={1.75} className="rtl:-scale-x-100" aria-hidden />
          {t.backToApp}
        </a>
        <IconButton label={t.switchLanguage} onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
          <Languages size={18} strokeWidth={1.75} />
        </IconButton>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-20">
        <article className="rounded-3xl bg-surface p-6 shadow-xs sm:p-10">
          <BrandMark size={40} />
          <h1 className={lang === 'ar' ? 'mt-5 text-display-ar text-ink' : 'mt-5 text-title-1 text-ink'}>{c.title}</h1>
          <p className="mt-2 text-caption text-ink-muted">
            {c.updated}: {UPDATED[lang]}
          </p>
          <p className={lang === 'ar' ? 'mt-6 max-w-prose text-message-ar text-ink' : 'mt-6 max-w-prose text-message text-ink'}>
            {c.intro}
          </p>

          {c.sections.map((section) => (
            <section key={section.title} className="mt-8">
              <h2 className={lang === 'ar' ? 'text-title-ar text-ink' : 'text-title-3 text-ink'}>{section.title}</h2>
              {section.body.map((paragraph) => (
                <p
                  key={paragraph}
                  className={
                    lang === 'ar'
                      ? 'mt-3 max-w-prose text-body-ar text-ink-muted'
                      : 'mt-3 max-w-prose text-body text-ink-muted'
                  }
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </article>
      </main>
    </div>
  )
}
