import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import DashboardPage from '../pages/DashboardPage';
import '@testing-library/jest-dom';

vi.mock('@/lib/api', () => ({
  listScans: vi.fn().mockResolvedValue({ scans: [] }),
  getScanResults: vi.fn().mockResolvedValue({ summary: {}, findings: [] }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: 'div',
  },
  useScroll: () => ({ scrollY: { get: () => 0 } }),
  useTransform: () => '0',
}));

describe('frontend.dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWithRouter = (component: React.ReactElement) => {
    return render(
      <BrowserRouter>
        {component}
      </BrowserRouter>
    );
  };

  it('should render the dashboard page', async () => {
    renderWithRouter(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();
    });
  });

  it('should render security issues stat card', async () => {
    renderWithRouter(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/Security Issues/i)).toBeInTheDocument();
    });
  });

  it('should render total scans stat card', async () => {
    renderWithRouter(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/Total Scans/i)).toBeInTheDocument();
    });
  });

  it('should render quality issues stat card', async () => {
    renderWithRouter(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Quality Issues/i)[0]).toBeInTheDocument();
    });
  });

  it('should render active scans stat card', async () => {
    renderWithRouter(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/Active Scans/i)).toBeInTheDocument();
    });
  });

  it('should render severity chart section', async () => {
    renderWithRouter(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/Severity/i)).toBeInTheDocument();
    });
  });

  it('should render vulnerabilities by type section', async () => {
    renderWithRouter(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/Vulnerabilities by Type/i)).toBeInTheDocument();
    });
  });

  it('should render recent scans section', async () => {
    renderWithRouter(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/Recent Scans/i)).toBeInTheDocument();
    });
  });

  it('should render top security findings section', async () => {
    renderWithRouter(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/Top Security Findings/i)).toBeInTheDocument();
    });
  });

  it('should render top quality issues section', async () => {
    renderWithRouter(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/Top Quality Issues/i)).toBeInTheDocument();
    });
  });
});
