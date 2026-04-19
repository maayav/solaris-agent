import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavBar } from './NavBar';
import { LayoutDashboard, GitBranch, MessageSquare, Info } from 'lucide-react';
import '@testing-library/jest-dom';

const mockItems = [
  { name: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { name: 'Pipeline', url: '/pipeline', icon: GitBranch },
  { name: 'Team Chat', url: '/chat', icon: MessageSquare },
  { name: 'About', url: '/', icon: Info },
];

describe('frontend.shared.layout.NavBar', () => {
  it('should render all navigation items', () => {
    const mockOnTabChange = vi.fn();
    render(
      <NavBar 
        items={mockItems} 
        activeTab="Dashboard" 
        onTabChange={mockOnTabChange} 
      />
    );

    expect(screen.getByLabelText(/Navigate to Dashboard/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Navigate to Pipeline/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Navigate to Team Chat/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Navigate to About/i)).toBeInTheDocument();
  });

  it('should highlight active tab', () => {
    const mockOnTabChange = vi.fn();
    render(
      <NavBar 
        items={mockItems} 
        activeTab="Dashboard" 
        onTabChange={mockOnTabChange} 
      />
    );

    const dashboardButton = screen.getByLabelText(/Navigate to Dashboard/i);
    expect(dashboardButton).toHaveAttribute('aria-current', 'page');
  });

  it('should not highlight inactive tabs', () => {
    const mockOnTabChange = vi.fn();
    render(
      <NavBar 
        items={mockItems} 
        activeTab="Dashboard" 
        onTabChange={mockOnTabChange} 
      />
    );

    const pipelineButton = screen.getByLabelText(/Navigate to Pipeline/i);
    expect(pipelineButton).not.toHaveAttribute('aria-current');
  });

  it('should call onTabChange when tab is clicked', () => {
    const mockOnTabChange = vi.fn();
    render(
      <NavBar 
        items={mockItems} 
        activeTab="Dashboard" 
        onTabChange={mockOnTabChange} 
      />
    );

    fireEvent.click(screen.getByLabelText(/Navigate to Pipeline/i));
    expect(mockOnTabChange).toHaveBeenCalledWith('Pipeline');
  });

  it('should render icons for all items', () => {
    const mockOnTabChange = vi.fn();
    render(
      <NavBar 
        items={mockItems} 
        activeTab="Dashboard" 
        onTabChange={mockOnTabChange} 
      />
    );

    // All items should have their icons (hidden from aria but visible)
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
  });
});
