'use client';

import { useParams } from 'next/navigation';
import ProfileView from '@/components/ProfileView';

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  // Mobile: its own page. Desktop: the people list shows this side-by-side,
  // but direct links still render fine full-width.
  return <ProfileView personId={id} backHref="/people" />;
}
