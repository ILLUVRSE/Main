import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

const meta: Meta<typeof Modal> = {
  title: 'UI/Modal',
  component: Modal,
  render: (args) => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open modal</Button>
        <Modal {...args} open={open} onClose={() => setOpen(false)} />
      </>
    );
  },
  args: {
    title: 'Preview manifest',
    subtitle: 'Manifest JSON preview for Illuvrse project',
    children: (
      <pre className="rounded-2xl bg-[var(--color-surface)] p-4 text-xs">
        {JSON.stringify({ manifest: 'sample' }, null, 2)}
      </pre>
    ),
  },
};

export default meta;
type Story = StoryObj<typeof Modal>;

export const Default: Story = {};
