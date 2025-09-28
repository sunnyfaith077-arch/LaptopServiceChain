(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-PROVIDER u101)
(define-constant ERR-INVALID-DURATION u102)
(define-constant ERR-INVALID-PREMIUM u103)
(define-constant ERR-INVALID-COVERAGE u104)
(define-constant ERR-INVALID-THRESHOLD u105)
(define-constant ERR-CONTRACT-ALREADY-EXISTS u106)
(define-constant ERR-CONTRACT-NOT-FOUND u107)
(define-constant ERR-INVALID-TIMESTAMP u108)
(define-constant ERR-AUTHORITY-NOT-VERIFIED u109)
(define-constant ERR-INVALID-MIN-PREMIUM u110)
(define-constant ERR-INVALID-MAX_COVERAGE u111)
(define-constant ERR-CONTRACT-UPDATE-NOT-ALLOWED u112)
(define-constant ERR-INVALID-UPDATE-PARAM u113)
(define-constant ERR-MAX-CONTRACTS-EXCEEDED u114)
(define-constant ERR-INVALID-CONTRACT-TYPE u115)
(define-constant ERR-INVALID-INTEREST-RATE u116)
(define-constant ERR-INVALID-GRACE-PERIOD u117)
(define-constant ERR-INVALID-DEVICE-ID u118)
(define-constant ERR-INVALID-CURRENCY u119)
(define-constant ERR-INVALID-STATUS u120)

(define-data-var next-contract-id uint u0)
(define-data-var max-contracts uint u1000)
(define-data-var creation-fee uint u1000)
(define-data-var authority-contract (optional principal) none)

(define-map contracts
  uint
  {
    owner: principal,
    provider: principal,
    start-time: uint,
    duration: uint,
    premium-amount: uint,
    coverage-type: (string-utf8 50),
    threshold: uint,
    timestamp: uint,
    contract-type: (string-utf8 50),
    interest-rate: uint,
    grace-period: uint,
    device-id: (string-utf8 100),
    currency: (string-utf8 20),
    status: bool,
    min-premium: uint,
    max-coverage: uint
  }
)

(define-map contracts-by-device
  (string-utf8 100)
  uint)

(define-map contract-updates
  uint
  {
    update-provider: principal,
    update-duration: uint,
    update-premium-amount: uint,
    update-timestamp: uint,
    updater: principal
  }
)

(define-read-only (get-contract (id uint))
  (map-get? contracts id)
)

(define-read-only (get-contract-updates (id uint))
  (map-get? contract-updates id)
)

(define-read-only (is-contract-registered (device-id (string-utf8 100)))
  (is-some (map-get? contracts-by-device device-id))
)

(define-private (validate-provider (provider principal))
  (if (not (is-eq provider 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-INVALID-PROVIDER))
)

(define-private (validate-duration (duration uint))
  (if (> duration u0)
      (ok true)
      (err ERR-INVALID-DURATION))
)

(define-private (validate-premium-amount (amount uint))
  (if (> amount u0)
      (ok true)
      (err ERR-INVALID-PREMIUM))
)

(define-private (validate-coverage-type (coverage (string-utf8 50)))
  (if (and (> (len coverage) u0) (<= (len coverage) u50))
      (ok true)
      (err ERR-INVALID-COVERAGE))
)

(define-private (validate-threshold (threshold uint))
  (if (and (> threshold u0) (<= threshold u100))
      (ok true)
      (err ERR-INVALID-THRESHOLD))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-contract-type (type (string-utf8 50)))
  (if (or (is-eq type "basic") (is-eq type "premium") (is-eq type "enterprise"))
      (ok true)
      (err ERR-INVALID-CONTRACT-TYPE))
)

(define-private (validate-interest-rate (rate uint))
  (if (<= rate u20)
      (ok true)
      (err ERR-INVALID-INTEREST-RATE))
)

(define-private (validate-grace-period (period uint))
  (if (<= period u30)
      (ok true)
      (err ERR-INVALID-GRACE-PERIOD))
)

(define-private (validate-device-id (id (string-utf8 100)))
  (if (and (> (len id) u0) (<= (len id) u100))
      (ok true)
      (err ERR-INVALID-DEVICE-ID))
)

(define-private (validate-currency (cur (string-utf8 20)))
  (if (or (is-eq cur "STX") (is-eq cur "USD") (is-eq cur "BTC"))
      (ok true)
      (err ERR-INVALID-CURRENCY))
)

(define-private (validate-min-premium (min uint))
  (if (> min u0)
      (ok true)
      (err ERR-INVALID-MIN-PREMIUM))
)

(define-private (validate-max-coverage (max uint))
  (if (> max u0)
      (ok true)
      (err ERR-INVALID-MAX_COVERAGE))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-principal contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-contracts (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-MAX-CONTRACTS-EXCEEDED))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set max-contracts new-max)
    (ok true)
  )
)

(define-public (set-creation-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR-INVALID-UPDATE-PARAM))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set creation-fee new-fee)
    (ok true)
  )
)

(define-public (create-contract
  (provider principal)
  (duration uint)
  (premium-amount uint)
  (coverage-type (string-utf8 50))
  (threshold uint)
  (contract-type (string-utf8 50))
  (interest-rate uint)
  (grace-period uint)
  (device-id (string-utf8 100))
  (currency (string-utf8 20))
  (min-premium uint)
  (max-coverage uint)
)
  (let (
        (next-id (var-get next-contract-id))
        (current-max (var-get max-contracts))
        (authority (var-get authority-contract))
      )
    (asserts! (< next-id current-max) (err ERR-MAX-CONTRACTS-EXCEEDED))
    (try! (validate-provider provider))
    (try! (validate-duration duration))
    (try! (validate-premium-amount premium-amount))
    (try! (validate-coverage-type coverage-type))
    (try! (validate-threshold threshold))
    (try! (validate-contract-type contract-type))
    (try! (validate-interest-rate interest-rate))
    (try! (validate-grace-period grace-period))
    (try! (validate-device-id device-id))
    (try! (validate-currency currency))
    (try! (validate-min-premium min-premium))
    (try! (validate-max-coverage max-coverage))
    (asserts! (is-none (map-get? contracts-by-device device-id)) (err ERR-CONTRACT-ALREADY-EXISTS))
    (let ((authority-recipient (unwrap! authority (err ERR-AUTHORITY-NOT-VERIFIED))))
      (try! (stx-transfer? (var-get creation-fee) tx-sender authority-recipient))
    )
    (map-set contracts next-id
      {
        owner: tx-sender,
        provider: provider,
        start-time: block-height,
        duration: duration,
        premium-amount: premium-amount,
        coverage-type: coverage-type,
        threshold: threshold,
        timestamp: block-height,
        contract-type: contract-type,
        interest-rate: interest-rate,
        grace-period: grace-period,
        device-id: device-id,
        currency: currency,
        status: true,
        min-premium: min-premium,
        max-coverage: max-coverage
      }
    )
    (map-set contracts-by-device device-id next-id)
    (var-set next-contract-id (+ next-id u1))
    (print { event: "contract-created", id: next-id })
    (ok next-id)
  )
)

(define-public (update-contract
  (contract-id uint)
  (update-provider principal)
  (update-duration uint)
  (update-premium-amount uint)
)
  (let ((contract (map-get? contracts contract-id)))
    (match contract
      c
        (begin
          (asserts! (is-eq (get owner c) tx-sender) (err ERR-NOT-AUTHORIZED))
          (try! (validate-provider update-provider))
          (try! (validate-duration update-duration))
          (try! (validate-premium-amount update-premium-amount))
          (let ((old-device-id (get device-id c)))
            (ok true)
          )
          (map-set contracts contract-id
            {
              owner: (get owner c),
              provider: update-provider,
              start-time: (get start-time c),
              duration: update-duration,
              premium-amount: update-premium-amount,
              coverage-type: (get coverage-type c),
              threshold: (get threshold c),
              timestamp: block-height,
              contract-type: (get contract-type c),
              interest-rate: (get interest-rate c),
              grace-period: (get grace-period c),
              device-id: (get device-id c),
              currency: (get currency c),
              status: (get status c),
              min-premium: (get min-premium c),
              max-coverage: (get max-coverage c)
            }
          )
          (map-set contract-updates contract-id
            {
              update-provider: update-provider,
              update-duration: update-duration,
              update-premium-amount: update-premium-amount,
              update-timestamp: block-height,
              updater: tx-sender
            }
          )
          (print { event: "contract-updated", id: contract-id })
          (ok true)
        )
      (err ERR-CONTRACT-NOT-FOUND)
    )
  )
)

(define-public (get-contract-count)
  (ok (var-get next-contract-id))
)

(define-public (check-contract-existence (device-id (string-utf8 100)))
  (ok (is-contract-registered device-id))
)