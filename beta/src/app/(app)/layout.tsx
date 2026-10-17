import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import TabBar from '@/components/TabBar';
import Sidebar from '@/components/Sidebar';
import GuestBanner from '@/components/GuestBanner';
import MobileGear from '@/components/MobileGear';
import UndoToast from '@/components/UndoToast';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return (
    <div className="min-h-dvh lg:flex lg:items-start lg:justify-center">
      <Sidebar />
      {/* mobile: narrow column; desktop: wide workspace */}
      <div
        className="flex-1 min-w-0 w-full max-w-xl lg:max-w-6xl mx-auto pb-24 lg:pb-10"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {user.isGuest && <GuestBanner />}
        <div className="relative lg:hidden">
          <MobileGear />
        </div>
        {children}
      </div>
      <div className="lg:hidden">
        <TabBar />
      </div>
      <UndoToast />
    </div>
  );
}
