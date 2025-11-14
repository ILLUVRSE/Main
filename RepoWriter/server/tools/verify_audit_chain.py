# verify_audit_chain.py
import json
import hashlib

class AuditEvent:
    def __init__(self, prev_hash, event_data, event_hash, signature):
        self.prev_hash = prev_hash
        self.event_data = event_data
        self.event_hash = event_hash
        self.signature = signature

    @staticmethod
    def from_json(json_data):
        return AuditEvent(
            json_data['prevHash'],
            json_data['eventData'],
            json_data['eventHash'],
            json_data['signature']
        )

def verify_chain(audit_events):
    for i in range(1, len(audit_events)):
        current_event = audit_events[i]
        previous_event = audit_events[i - 1]
        if current_event.prev_hash != previous_event.event_hash:
            return False
    return True

if __name__ == '__main__':
    with open('audit_events.json') as f:
        events = [AuditEvent.from_json(json.loads(line)) for line in f]
    if verify_chain(events):
        print('Audit chain is valid.')
    else:
        print('Audit chain is invalid.')