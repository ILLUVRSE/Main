// Append-only corrections handling

class AuditEvent {
    constructor(public action: string, public timestamp: Date) {}
}

const appendOnlyCorrections: AuditEvent[] = [];

function addCorrection(action: string) {
    const event = new AuditEvent(action, new Date());
    appendOnlyCorrections.push(event);
    // Logic to handle the correction
}

// Example usage
addCorrection('File updated');