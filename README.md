# LaptopServiceChain

## Overview

LaptopServiceChain is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It addresses real-world problems in laptop warranty and service management, such as opaque complaint tracking, delayed resolutions, and lack of accountability in service contracts. Traditional systems often involve centralized databases prone to manipulation, slow customer support, and disputes over service fulfillment. This project leverages blockchain for transparent, immutable tracking of service contracts, automating virtual monitoring (e.g., remote diagnostics via oracles) and in-person interventions (e.g., dispatching technicians through triggered events).

Key features:
- Users (laptop owners) can register service contracts tied to their devices.
- Complaints are filed on-chain, triggering automated virtual monitoring.
- If issues persist, smart contracts escalate to in-person interventions with escrow payments.
- All actions are auditable, reducing fraud and improving trust between users, manufacturers, and service providers.
- Integrates with off-chain oracles for real-time data (e.g., device status).

This solves problems like:
- **Delayed Resolutions**: Automated triggers ensure quick escalations.
- **Lack of Transparency**: Blockchain logs all steps immutably.
- **Dispute Prone Processes**: Smart contracts enforce rules without intermediaries.
- **Inefficient Monitoring**: Virtual checks reduce unnecessary physical visits.

The project consists of 6 core smart contracts written in Clarity, deployed on Stacks (Bitcoin-secured Layer 2). It assumes wallet-based authentication (e.g., via Hiro Wallet) and can integrate with front-end dApps for user interaction.

## Architecture

- **User Flow**:
  1. Register a service contract for a laptop.
  2. File a complaint (e.g., hardware failure).
  3. Smart contract triggers virtual monitoring (oracle-fed data).
  4. If unresolved, escrow releases funds for in-person intervention.
  5. Resolution is confirmed on-chain, closing the contract.

- **Smart Contracts** (6 in total):
  1. **UserRegistry.clar**: Manages user and provider registrations.
  2. **ServiceContractFactory.clar**: Creates and manages service contracts.
  3. **ComplaintManager.clar**: Handles complaint filing and status tracking.
  4. **MonitoringOracle.clar**: Interfaces with off-chain oracles for virtual monitoring.
  5. **InterventionDispatcher.clar**: Triggers and tracks in-person interventions.
  6. **PaymentEscrow.clar**: Manages escrow for payments and refunds.

Contracts interact via public functions, ensuring modularity and security. All use STX (Stacks token) for transactions, with optional SIP-010 token support for custom payments.

## Smart Contracts Details

Below are the Clarity code snippets for each contract. In a full deployment, place each in its own `.clar` file. Contracts use traits for interoperability (e.g., oracle traits).

### 1. UserRegistry.clar
This contract registers users (principals) as customers or service providers, storing metadata like device IDs.

```clarity
(define-map users principal { role: (string-ascii 32), device-id: (optional (string-ascii 64)) })

(define-public (register-user (role (string-ascii 32)) (device-id (optional (string-ascii 64))))
  (map-set users tx-sender { role: role, device-id: device-id })
  (ok true)
)

(define-read-only (get-user (user principal))
  (map-get? users user)
)
```

### 2. ServiceContractFactory.clar
Creates new service contracts with terms like warranty duration and coverage.

```clarity
(define-map contracts uint { owner: principal, provider: principal, start-time: uint, duration: uint, status: (string-ascii 32) })
(define-data-var contract-counter uint u0)

(define-public (create-contract (provider principal) (duration uint))
  (let ((contract-id (var-get contract-counter)))
    (map-set contracts contract-id { owner: tx-sender, provider: provider, start-time: block-height, duration: duration, status: "active" })
    (var-set contract-counter (+ contract-id u1))
    (ok contract-id)
  )
)

(define-read-only (get-contract (contract-id uint))
  (map-get? contracts contract-id)
)
```

### 3. ComplaintManager.clar
Allows filing complaints linked to contracts, updating statuses.

```clarity
(define-map complaints uint { contract-id: uint, description: (string-ascii 256), status: (string-ascii 32), timestamp: uint })
(define-data-var complaint-counter uint u0)

(define-public (file-complaint (contract-id uint) (description (string-ascii 256)))
  (let ((complaint-id (var-get complaint-counter)))
    (try! (asserts! (is-some (map-get? contracts contract-id)) (err u100))) ;; Check contract exists
    (map-set complaints complaint-id { contract-id: contract-id, description: description, status: "pending", timestamp: block-height })
    (var-set complaint-counter (+ complaint-id u1))
    (ok complaint-id)
  )
)

(define-public (update-complaint-status (complaint-id uint) (new-status (string-ascii 32)))
  (match (map-get? complaints complaint-id)
    some-complaint
      (begin
        (map-set complaints complaint-id (merge some-complaint { status: new-status }))
        (ok true)
      )
    (err u101)
  )
)
```

### 4. MonitoringOracle.clar
Interfaces with external oracles for virtual monitoring (e.g., device diagnostics). Assumes an oracle trait for data feeds.

```clarity
(define-trait oracle-trait
  ((get-data (uint) (response (string-ascii 256) uint)))
)

(define-map monitoring-results uint { complaint-id: uint, result: (string-ascii 256), resolved: bool })

(define-public (trigger-monitoring (complaint-id uint) (oracle <oracle-trait>))
  (let ((data (unwrap! (contract-call? oracle get-data complaint-id) (err u200))))
    (map-set monitoring-results complaint-id { complaint-id: complaint-id, result: data, resolved: (is-eq data "resolved") })
    (if (is-eq data "resolved")
      (contract-call? .complaint-manager update-complaint-status complaint-id "resolved")
      (ok false) ;; Escalate if not resolved
    )
  )
)
```

### 5. InterventionDispatcher.clar
Triggers in-person interventions if virtual monitoring fails, dispatching to providers.

```clarity
(define-map interventions uint { complaint-id: uint, provider: principal, status: (string-ascii 32), completion-time: (optional uint) })

(define-public (dispatch-intervention (complaint-id uint) (provider principal))
  (try! (asserts! (is-eq (default-to "pending" (get status (map-get? complaints complaint-id))) "escalated") (err u300)))
  (map-set interventions complaint-id { complaint-id: complaint-id, provider: provider, status: "dispatched", completion-time: none })
  (ok true)
)

(define-public (complete-intervention (complaint-id uint))
  (match (map-get? interventions complaint-id)
    some-intervention
      (begin
        (map-set interventions complaint-id (merge some-intervention { status: "completed", completion-time: (some block-height) }))
        (contract-call? .complaint-manager update-complaint-status complaint-id "resolved")
      )
    (err u301)
  )
)
```

### 6. PaymentEscrow.clar
Handles escrow for service fees, releasing on resolution or refunding on disputes.

```clarity
(define-map escrows uint { complaint-id: uint, amount: uint, payer: principal, payee: principal, released: bool })

(define-public (deposit-escrow (complaint-id uint) (amount uint) (payee principal))
  (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
  (map-set escrows complaint-id { complaint-id: complaint-id, amount: amount, payer: tx-sender, payee: payee, released: false })
  (ok true)
)

(define-public (release-escrow (complaint-id uint))
  (match (map-get? escrows complaint-id)
    some-escrow
      (if (is-eq (default-to "pending" (get status (map-get? complaints complaint-id))) "resolved")
        (begin
          (as-contract (try! (stx-transfer? (get amount some-escrow) tx-sender (get payee some-escrow))))
          (map-set escrows complaint-id (merge some-escrow { released: true }))
          (ok true)
        )
        (err u400)
      )
    (err u401)
  )
)

(define-public (refund-escrow (complaint-id uint))
  (match (map-get? escrows complaint-id)
    some-escrow
      (begin
        (as-contract (try! (stx-transfer? (get amount some-escrow) tx-sender (get payer some-escrow))))
        (map-set escrows complaint-id (merge some-escrow { released: true }))
        (ok true)
      )
    (err u402)
  )
)
```

## Installation

1. Install the Stacks CLI: Follow [official docs](https://docs.stacks.co/docs/write-smart-contracts/clarity-language).
2. Clone the repo: `git clone <repo-url>`.
3. Place each contract in a separate `.clar` file in `/contracts`.
4. Test locally with Clarinet: `clarinet test`.
5. Deploy to Stacks testnet/mainnet using Hiro Developer Console or Clarinet.

## Usage

- **Deploy Contracts**: Use `clarinet deploy` or manual deployment.
- **Interact via dApp**: Build a front-end (e.g., React + @stacks/connect) to call functions like `create-contract`.
- **Oracle Integration**: Implement an off-chain oracle (e.g., via Chainlink on Stacks) for `MonitoringOracle`.
- **Testing**: Simulate flows: Register user → Create contract → File complaint → Monitor → Dispatch intervention → Release escrow.

## Security Notes

- All contracts use `try!` and `asserts!` for error handling.
- Avoid reentrancy by structuring calls carefully.
- Audit before mainnet deployment.

## License

MIT License. See LICENSE file for details.

## Contributing

Pull requests welcome! Focus on improving Clarity code or adding features like NFT-based device ownership.