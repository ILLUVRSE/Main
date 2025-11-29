'use client';

import { useState, useEffect } from 'react';

export default function MultisigPage() {
  const [proposals, setProposals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/multisig')
      .then(res => res.json())
      .then(data => setProposals(data))
      .catch(err => console.error(err));
  }, []);

  const createProposal = async () => {
      setLoading(true);
      const res = await fetch('/api/multisig', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create', title: 'New Upgrade', payload: {} })
      });
      const data = await res.json();
      setProposals([...proposals, data]);
      setLoading(false);
  };

  const approveProposal = async (id: string) => {
      setLoading(true);
      await fetch('/api/multisig', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve', id })
      });
      // Refresh
      const res = await fetch('/api/multisig');
      const data = await res.json();
      setProposals(data);
      setLoading(false);
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Multisig Governance</h1>

      <div className="mb-8">
          <button
            onClick={createProposal}
            disabled={loading}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
          >
              Create Proposal
          </button>
      </div>

      <div className="grid gap-4">
          {proposals.map((p: any) => (
              <div key={p.id} className="border p-4 rounded shadow">
                  <h3 className="font-bold">{p.title}</h3>
                  <p>Status: <span className={`font-mono ${p.status === 'approved' ? 'text-green-600' : 'text-yellow-600'}`}>{p.status}</span></p>
                  <p>ID: {p.id}</p>
                  {p.status === 'pending' && (
                      <button
                        onClick={() => approveProposal(p.id)}
                        className="mt-2 bg-green-500 text-white px-3 py-1 rounded text-sm"
                      >
                          Approve (Simulate)
                      </button>
                  )}
              </div>
          ))}
      </div>
    </div>
  );
}
