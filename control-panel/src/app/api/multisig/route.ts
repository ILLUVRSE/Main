
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json();
  console.log('Multisig UI Action:', body);
  // In a real app, this would call the Kernel API
  // await fetch(process.env.KERNEL_URL + '/kernel/multisig/' + body.proposalId + '/approve', ...);
  return NextResponse.json({ status: 'simulated', action: body.action, proposalId: body.proposalId });
}
