import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    let body;
    try {
        body = await request.json();
    } catch (e) {
        console.error('JSON parse error:', e);
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { action, ...data } = body;
    console.log('Action:', action, 'Data:', data);

    // Simulate different actions
    if (action === 'create') {
      const id = 'prop-' + Math.random().toString(36).substring(2, 9);
      return NextResponse.json({
        id,
        status: 'pending',
        ...data
      });
    }

    if (action === 'approve') {
       return NextResponse.json({
         status: 'approved', // Simulating approval
         approvals: 3
       });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal Error', details: String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
    // Return mock proposals
    return NextResponse.json([
        { id: 'prop-1', title: 'Upgrade to v2', status: 'pending', approvals: 1 },
        { id: 'prop-2', title: 'Change Policy', status: 'approved', approvals: 3 }
    ]);
}
