# Marketplace — Specification

## API
### `POST /marketplace/sku`
- Register SKU referencing Kernel-signed manifest.

### `POST /marketplace/checkout`
- Start checkout session; create order, call Stripe, on success call Finance to create ledger entry.

### `GET /marketplace/sku/{id}/license/verify`
- Validate signature and ownership.

### `POST /marketplace/preview`
- Create ephemeral preview sandbox; returns `preview_url` valid for TTL.

### `POST /marketplace/deliver`
- Generate encrypted delivery package and record audit event.

## Security
- PCI compliance: do not store card data.
- Signed manifests required for SKU creation.

