;; contracts/PaymentEscrow.clar
(impl-trait .payment-escrow-trait.payment-escrow-trait)

(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-INVALID-PAYEE u102)
(define-constant ERR-INVALID-TIMEOUT u103)
(define-constant ERR-ESCROW-NOT-FOUND u104)
(define-constant ERR-ALREADY-RELEASED u105)
(define-constant ERR-DISPUTE-ACTIVE u106)
(define-constant ERR-VOTING-NOT-ENDED u107)
(define-constant ERR-INSUFFICIENT-VOTES u108)
(define-constant ERR-INVALID-VOTE u109)
(define-constant ERR-TIMEOUT-EXPIRED u110)
(define-constant ERR-INVALID-ESCROW-TYPE u111)
(define-constant ERR-MAX-ESCROWS-EXCEEDED u112)
(define-constant ERR-FEE-INSUFFICIENT u113)

(define-data-var next-escrow-id uint u0)
(define-data-var max-escrows uint u500)
(define-data-var escrow-fee uint u500)
(define-data-var authority-contract (optional principal) none)
(define-data-var default-timeout uint u144) ;; ~24 hours in blocks

(define-map escrows
  uint
  {
    payer: principal,
    payee: principal,
    amount: uint,
    timeout: uint,
    status: (string-utf8 20),
    timestamp: uint,
    escrow-type: (string-utf8 20),
    dispute-id: (optional uint),
    votes-for-release: uint,
    votes-for-refund: uint,
    voters: (list 50 principal)
  }
)

(define-map disputes
  uint
  {
    escrow-id: uint,
    description: (string-utf8 256),
    raised-by: principal,
    raised-at: uint,
    resolved: bool,
    resolution: (string-utf8 20)
  }
)

(define-map escrow-fees-collected
  principal
  uint
)

(define-read-only (get-escrow (id uint))
  (map-get? escrows id)
)

(define-read-only (get-dispute (id uint))
  (map-get? disputes id)
)

(define-read-only (get-escrow-count)
  (ok (var-get next-escrow-id))
)

(define-read-only (is-escrow-active (id uint))
  (match (map-get? escrows id)
    e (is-eq (get status e) "active")
    false
  )
)

(define-private (validate-amount (amt uint))
  (if (> amt u0)
      (ok true)
      (err ERR-INVALID-AMOUNT))
)

(define-private (validate-payee (p principal))
  (if (not (is-eq p tx-sender))
      (ok true)
      (err ERR-INVALID-PAYEE))
)

(define-private (validate-timeout (t uint))
  (if (> t u0)
      (ok true)
      (err ERR-INVALID-TIMEOUT))
)

(define-private (validate-escrow-type (t (string-utf8 20)))
  (if (or (is-eq t "service") (is-eq t "dispute") (is-eq t "timelock"))
      (ok true)
      (err ERR-INVALID-ESCROW-TYPE))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)

(define-private (can-vote (escrow-id uint) (voter principal))
  (let ((escrow (unwrap! (map-get? escrows escrow-id) (err u0))))
    (and (not (contains (get voters escrow) voter))
         (is-eq (get status escrow) "disputed"))
  )
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-principal contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-escrows (new-max uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set max-escrows new-max)
    (ok true)
  )
)

(define-public (set-escrow-fee (new-fee uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set escrow-fee new-fee)
    (ok true)
  )
)

(define-public (set-default-timeout (new-timeout uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set default-timeout new-timeout)
    (ok true)
  )
)

(define-public (create-escrow
  (payee principal)
  (amount uint)
  (custom-timeout (optional uint))
  (escrow-type (string-utf8 20))
)
  (let (
        (next-id (var-get next-escrow-id))
        (current-max (var-get max-escrows))
        (timeout (match custom-timeout t t (var-get default-timeout)))
        (authority (var-get authority-contract))
      )
    (asserts! (< next-id current-max) (err ERR-MAX-ESCROWS-EXCEEDED))
    (try! (validate-amount amount))
    (try! (validate-payee payee))
    (try! (validate-timeout timeout))
    (try! (validate-escrow-type escrow-type))
    (asserts! (is-some authority) (err ERR-NOT-AUTHORIZED))
    (let ((auth-recipient (unwrap! authority (err u0))))
      (try! (stx-transfer? (+ amount (var-get escrow-fee)) tx-sender (as-contract tx-sender)))
      (try! (as-contract (stx-transfer? (var-get escrow-fee) tx-sender auth-recipient)))
      (map-set escrow-fees-collected auth-recipient (+ (default-to u0 (map-get? escrow-fees-collected auth-recipient)) (var-get escrow-fee)))
    )
    (map-set escrows next-id
      {
        payer: tx-sender,
        payee: payee,
        amount: amount,
        timeout: (+ block-height timeout),
        status: "active",
        timestamp: block-height,
        escrow-type: escrow-type,
        dispute-id: none,
        votes-for-release: u0,
        votes-for-refund: u0,
        voters: (list )
      }
    )
    (as-contract (stx-transfer-memo? amount tx-sender (as-contract tx-sender) "Escrow deposit"))
    (var-set next-escrow-id (+ next-id u1))
    (print { event: "escrow-created", id: next-id })
    (ok next-id)
  )
)

(define-public (release-escrow (escrow-id uint))
  (let ((escrow (unwrap! (map-get? escrows escrow-id) (err ERR-ESCROW-NOT-FOUND)))
        (current-status (get status escrow)))
    (asserts! (is-eq current-status "active") (err ERR-DISPUTE-ACTIVE))
    (asserts! (<= block-height (get timeout escrow)) (err ERR-TIMEOUT-EXPIRED))
    (asserts! (is-eq (get payee escrow) tx-sender) (err ERR-NOT-AUTHORIZED))
    (as-contract (try! (stx-transfer? (get amount escrow) tx-sender (get payee escrow))))
    (map-set escrows escrow-id (merge escrow { status: "released" }))
    (print { event: "escrow-released", id: escrow-id })
    (ok true)
  )
)

(define-public (refund-escrow (escrow-id uint))
  (let ((escrow (unwrap! (map-get? escrows escrow-id) (err ERR-ESCROW-NOT-FOUND)))
        (current-status (get status escrow)))
    (asserts! (is-eq current-status "active") (err ERR-DISPUTE-ACTIVE))
    (asserts! (> block-height (get timeout escrow)) (err ERR-TIMEOUT-EXPIRED))
    (asserts! (is-eq (get payer escrow) tx-sender) (err ERR-NOT-AUTHORIZED))
    (as-contract (try! (stx-transfer? (get amount escrow) tx-sender (get payer escrow))))
    (map-set escrows escrow-id (merge escrow { status: "refunded" }))
    (print { event: "escrow-refunded", id: escrow-id })
    (ok true)
  )
)

(define-public (raise-dispute (escrow-id uint) (description (string-utf8 256)))
  (let ((escrow (unwrap! (map-get? escrows escrow-id) (err ERR-ESCROW-NOT-FOUND))))
    (asserts! (is-eq (get status escrow) "active") (err ERR-DISPUTE-ACTIVE))
    (asserts! (or (is-eq (get payer escrow) tx-sender) (is-eq (get payee escrow) tx-sender)) (err ERR-NOT-AUTHORIZED))
    (map-set escrows escrow-id (merge escrow { status: "disputed", dispute-id: (some (var-get next-escrow-id)) }))
    (map-set disputes (var-get next-escrow-id)
      {
        escrow-id: escrow-id,
        description: description,
        raised-by: tx-sender,
        raised-at: block-height,
        resolved: false,
        resolution: ""
      }
    )
    (var-set next-escrow-id (+ (var-get next-escrow-id) u1))
    (print { event: "dispute-raised", id: escrow-id })
    (ok true)
  )
)

(define-public (vote-on-dispute (escrow-id uint) (vote-for-release bool))
  (let ((escrow (unwrap! (map-get? escrows escrow-id) (err ERR-ESCROW-NOT-FOUND)))
        (dispute-id (unwrap! (get dispute-id escrow) (err ERR-DISPUTE-ACTIVE))))
    (asserts! (can-vote escrow-id tx-sender) (err ERR-INVALID-VOTE))
    (let ((current-voters (get voters escrow))
          (new-voters (unwrap! (fold add-voter current-voters (list tx-sender)) (err u0)))
          (votes-release (if vote-for-release (+ (get votes-for-release escrow) u1) (get votes-for-release escrow)))
          (votes-refund (if (not vote-for-release) (+ (get votes-for-refund escrow) u1) (get votes-for-refund escrow))))
      (map-set escrows escrow-id
        (merge escrow
          {
            votes-for-release: votes-release,
            votes-for-refund: votes-refund,
            voters: new-voters
          }
        )
      )
      (if (> block-height (+ (get raised-at (unwrap! (map-get? disputes dispute-id) (err u0))) u288)) ;; ~2 days
          (resolve-dispute escrow-id)
          (ok true)
      )
    )
  )
)

(define-private (add-voter (voters (list 50 principal)) (voter principal))
  (if (is-some (index-of voters voter))
      voters
      (unwrap! (as-max-len? (append voters voter) u50) voters)
  )
)

(define-private (resolve-dispute (escrow-id uint))
  (let ((escrow (unwrap! (map-get? escrows escrow-id) (err u0)))
        (dispute-id (unwrap! (get dispute-id escrow) (err u0)))
        (dispute (unwrap! (map-get? disputes dispute-id) (err u0)))
        (release-votes (get votes-for-release escrow))
        (refund-votes (get votes-for-refund escrow))
        (total-votes (+ release-votes refund-votes)))
    (if (> total-votes u0)
        (let ((release-perc (* release-votes u100)))
          (if (> release-perc u50)
              (begin
                (as-contract (stx-transfer? (get amount escrow) tx-sender (get payee escrow)))
                (map-set escrows escrow-id (merge escrow { status: "released" }))
                (map-set disputes dispute-id (merge dispute { resolved: true, resolution: "release" }))
                (print { event: "dispute-resolved-release", id: escrow-id })
                (ok true)
              )
              (begin
                (as-contract (stx-transfer? (get amount escrow) tx-sender (get payer escrow)))
                (map-set escrows escrow-id (merge escrow { status: "refunded" }))
                (map-set disputes dispute-id (merge dispute { resolved: true, resolution: "refund" }))
                (print { event: "dispute-resolved-refund", id: escrow-id })
                (ok true)
              )
          )
        )
        (err ERR-INSUFFICIENT-VOTES)
    )
  )
)

(define-public (withdraw-fees (principal))
  (let ((fees (default-to u0 (map-get? escrow-fees-collected principal))))
    (asserts! (is-eq principal (unwrap! (var-get authority-contract) (err ERR-NOT-AUTHORIZED))) (err ERR-NOT-AUTHORIZED))
    (asserts! (> fees u0) (err ERR-INVALID-AMOUNT))
    (as-contract (try! (stx-transfer? fees tx-sender principal)))
    (map-set escrow-fees-collected principal u0)
    (ok fees)
  )
)