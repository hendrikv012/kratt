'use client'

import { useAuth } from '@/lib/hooks/use-auth'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { User, Languages, LogOut } from 'lucide-react'

const LANGUAGES: Array<{ code: string; labelKey: string; matches: (lang: string) => boolean }> = [
  { code: 'en-US', labelKey: 'common.english', matches: (l) => l === 'en-US' || l.startsWith('en') },
  { code: 'ca-ES', labelKey: 'common.catalan', matches: (l) => l === 'ca-ES' || l.startsWith('ca') },
  { code: 'zh-CN', labelKey: 'common.chinese', matches: (l) => l === 'zh-CN' || l.startsWith('zh-Hans') || l === 'zh' },
  { code: 'zh-TW', labelKey: 'common.traditionalChinese', matches: (l) => l === 'zh-TW' || l.startsWith('zh-Hant') },
  { code: 'pt-BR', labelKey: 'common.portuguese', matches: (l) => l === 'pt-BR' || l.startsWith('pt') },
  { code: 'ja-JP', labelKey: 'common.japanese', matches: (l) => l === 'ja-JP' || l.startsWith('ja') },
  { code: 'fr-FR', labelKey: 'common.french', matches: (l) => l === 'fr-FR' || l.startsWith('fr') },
  { code: 'ru-RU', labelKey: 'common.russian', matches: (l) => l === 'ru-RU' || l.startsWith('ru') },
  { code: 'bn-IN', labelKey: 'common.bengali', matches: (l) => l === 'bn-IN' || l.startsWith('bn') },
  { code: 'es-ES', labelKey: 'common.spanish', matches: (l) => l === 'es-ES' || l.startsWith('es') },
  { code: 'de-DE', labelKey: 'common.german', matches: (l) => l === 'de-DE' || l.startsWith('de') },
  { code: 'pl-PL', labelKey: 'common.polish', matches: (l) => l === 'pl-PL' || l.startsWith('pl') },
  { code: 'tr-TR', labelKey: 'common.turkish', matches: (l) => l === 'tr-TR' || l.startsWith('tr') },
]

interface AccountMenuProps {
  isCollapsed?: boolean
}

export function AccountMenu({ isCollapsed = false }: AccountMenuProps) {
  const { language, setLanguage, t } = useTranslation()
  const { logout } = useAuth()
  const currentLang = language || 'en-US'

  const trigger = (
    <button
      type="button"
      className={
        isCollapsed
          ? 'flex h-9 w-full items-center justify-center rounded-md sidebar-menu-item'
          : 'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left sidebar-menu-item hover:bg-sidebar-accent'
      }
    >
      <Avatar size="sm">
        <AvatarFallback>
          <User className="h-3.5 w-3.5" />
        </AvatarFallback>
      </Avatar>
      {!isCollapsed && <span className="text-[13px] font-medium">{t('common.account')}</span>}
      <span className="sr-only">{t('common.account')}</span>
    </button>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages className="mr-2 h-4 w-4" />
            <span>{t('common.language')}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {LANGUAGES.map(({ code, labelKey, matches }) => (
              <DropdownMenuItem
                key={code}
                onClick={() => setLanguage(code)}
                className={matches(currentLang) ? 'bg-accent' : ''}
              >
                <span>{t(labelKey)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>{t('common.signOut')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
