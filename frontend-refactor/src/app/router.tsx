import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { RootLayout } from '@/shared/components/layout/RootLayout';
import { DashboardLayout } from '@/shared/components/layout/DashboardLayout';

const LandingPage = lazy(() => import('@/features/landing/pages/LandingPage'));
const DashboardPage = lazy(() => import('@/features/dashboard/pages/DashboardPage'));
const PipelinePage = lazy(() => import('@/features/pipeline/pages/PipelinePage'));
const ChatPage = lazy(() => import('@/features/chat/pages/ChatPage'));
const SwarmPage = lazy(() => import('@/features/swarm/pages/SwarmPage'));

function LoadingFallback() {
  return <div className="flex h-screen items-center justify-center">Loading...</div>;
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      {children}
    </Suspense>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        path: '/',
        element: <PageWrapper><LandingPage /></PageWrapper>,
      },
      {
        path: '/dashboard',
        element: <DashboardLayout />,
        children: [
          {
            index: true,
            element: <PageWrapper><DashboardPage /></PageWrapper>,
          },
        ],
      },
      {
        path: '/pipeline',
        element: <DashboardLayout />,
        children: [
          {
            index: true,
            element: <PageWrapper><PipelinePage /></PageWrapper>,
          },
        ],
      },
      {
        path: '/chat',
        element: <DashboardLayout />,
        children: [
          {
            index: true,
            element: <PageWrapper><ChatPage /></PageWrapper>,
          },
        ],
      },
      {
        path: '/swarm',
        element: <PageWrapper><SwarmPage /></PageWrapper>,
      },
    ],
  },
]);

export function Router() {
  return <RouterProvider router={router} />;
}
