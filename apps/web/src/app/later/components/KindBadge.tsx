'use client';

import { useTranslation } from '@/hooks/useTranslation';
import type { ItemKind } from '@/libs/later/kind';

const KindBadge = ({ kind }: { kind: ItemKind }) => {
  const _ = useTranslation();
  const label: Record<ItemKind, string> = {
    article: _('Article'),
    link: _('Link'),
    video: _('Video'),
    document: _('Document'),
  };
  return <span className='badge badge-ghost badge-sm'>{label[kind]}</span>;
};

export default KindBadge;
